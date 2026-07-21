import { and, asc, desc, eq } from "drizzle-orm";

import type {
  DeliverableIllustration,
  IllustrationRepository,
  PublishApprovedInput,
  RecordOriginalInput,
  RecordReviewInput,
  SpecJob,
} from "@/application/ports/illustration-repository";
import type { IllustrationState } from "@/domain/image-job";
import type { Database } from "../client";
import {
  illustrationAssets,
  illustrationPublications,
  illustrationReviews,
  illustrationRevisions,
  illustrationSpecs,
  stories,
} from "../schema";

/**
 * Drizzle implementation of {@link IllustrationRepository}. Only this layer knows
 * the table shape. Published illustrations are IMMUTABLE revisions (rule 5), minted
 * with deterministic ids so a crash/resume re-records the same rows. Delivery is
 * constrained to an `approved` asset of a spec whose publication is `approved`, so
 * rejected/quarantined/retired originals are unreachable through the reader path
 * (rule 9), proven by tests.
 */

export function createIllustrationRepository(
  db: Database,
): IllustrationRepository {
  return {
    async getSpecJob(familyId, specId): Promise<SpecJob | null> {
      const [row] = await db
        .select({
          specId: illustrationSpecs.id,
          familyId: illustrationSpecs.familyId,
          storyId: illustrationSpecs.storyId,
          chapterId: illustrationSpecs.chapterId,
          chapterRevisionId: illustrationSpecs.revisionId,
          anchorKey: illustrationSpecs.anchorKey,
          caption: illustrationSpecs.caption,
          sceneDescription: illustrationSpecs.sceneDescription,
          aspect: illustrationSpecs.aspect,
          companions: illustrationSpecs.companions,
          settingLocation: illustrationSpecs.settingLocation,
          settingTimeOfDay: illustrationSpecs.settingTimeOfDay,
          subjectCharacterIds: illustrationSpecs.subjectCharacterIds,
          prominentCharacterId: illustrationSpecs.prominentCharacterId,
          storyType: stories.type,
        })
        .from(illustrationSpecs)
        .innerJoin(stories, eq(illustrationSpecs.storyId, stories.id))
        .where(
          and(
            eq(illustrationSpecs.id, specId),
            eq(illustrationSpecs.familyId, familyId),
          ),
        )
        .limit(1);
      if (!row) return null;

      const [latest] = await db
        .select({ n: illustrationRevisions.revisionNumber })
        .from(illustrationRevisions)
        .where(eq(illustrationRevisions.specId, specId))
        .orderBy(desc(illustrationRevisions.revisionNumber))
        .limit(1);

      return {
        specId: row.specId,
        familyId: row.familyId,
        storyId: row.storyId,
        storyType: row.storyType,
        chapterId: row.chapterId,
        chapterRevisionId: row.chapterRevisionId,
        anchorKey: row.anchorKey,
        caption: row.caption,
        sceneDescription: row.sceneDescription,
        aspect: row.aspect,
        companions: row.companions ?? [],
        // Setting is carried only when BOTH columns are present (they are written
        // together); otherwise it is absent (safe absence — review skips it).
        setting:
          row.settingLocation && row.settingTimeOfDay
            ? {
                location: row.settingLocation,
                timeOfDay: row.settingTimeOfDay,
              }
            : null,
        subjectCharacterIds: row.subjectCharacterIds,
        prominentCharacterId: row.prominentCharacterId ?? null,
        latestRevisionNumber: latest?.n ?? 0,
      };
    },

    async listSpecIdsForChapterRevision(familyId, chapterRevisionId) {
      const rows = await db
        .select({ id: illustrationSpecs.id })
        .from(illustrationSpecs)
        .where(
          and(
            eq(illustrationSpecs.revisionId, chapterRevisionId),
            eq(illustrationSpecs.familyId, familyId),
          ),
        )
        .orderBy(asc(illustrationSpecs.orderIndex));
      return rows.map((r) => r.id);
    },

    async ensurePublicationPending({ familyId, storyId, specId }) {
      await db
        .insert(illustrationPublications)
        .values({ familyId, storyId, specId, state: "pending" })
        .onConflictDoNothing({ target: illustrationPublications.specId });
    },

    async recordOriginal(input: RecordOriginalInput) {
      await db
        .insert(illustrationAssets)
        .values({
          id: input.id,
          familyId: input.familyId,
          storyId: input.storyId,
          chapterId: input.chapterId,
          chapterRevisionId: input.chapterRevisionId,
          specId: input.specId,
          kind: "original",
          phase: input.phase,
          state: "quarantined",
          storageKey: input.storageKey,
          contentType: input.contentType,
          checksum: input.checksum,
          byteSize: input.byteSize,
          width: input.width,
          height: input.height,
          model: input.model,
          seed: input.seed,
        })
        .onConflictDoNothing({ target: illustrationAssets.id });
    },

    async recordReview(input: RecordReviewInput) {
      await db
        .insert(illustrationReviews)
        .values({
          id: input.id,
          familyId: input.familyId,
          specId: input.specId,
          workflowId: input.workflowId,
          phase: input.phase,
          verdict: input.verdict,
          decision: input.decision,
        })
        .onConflictDoNothing({
          target: [
            illustrationReviews.specId,
            illustrationReviews.workflowId,
            illustrationReviews.phase,
          ],
        });
    },

    async publishApproved(input: PublishApprovedInput) {
      const now = input.now ?? new Date();
      await db.transaction(async (tx) => {
        // Retire every currently-approved asset of this spec (a prior revision's
        // original) except the new original, so a superseded illustration is never
        // deliverable (rule 5/9).
        const approvedAssets = await tx
          .select({ id: illustrationAssets.id })
          .from(illustrationAssets)
          .where(
            and(
              eq(illustrationAssets.specId, input.specId),
              eq(illustrationAssets.state, "approved"),
            ),
          );
        for (const asset of approvedAssets) {
          if (asset.id === input.originalAssetId) continue;
          await tx
            .update(illustrationAssets)
            .set({ state: "retired" })
            .where(eq(illustrationAssets.id, asset.id));
        }

        // Approve the new original. ADR-007: no derivatives are written — the
        // approved original is the delivered asset.
        await tx
          .update(illustrationAssets)
          .set({ state: "approved", reviewedAt: now })
          .where(eq(illustrationAssets.id, input.originalAssetId));

        // Mint the immutable illustration revision.
        await tx
          .insert(illustrationRevisions)
          .values({
            id: input.revisionId,
            familyId: input.familyId,
            storyId: input.storyId,
            chapterId: input.chapterId,
            chapterRevisionId: input.chapterRevisionId,
            specId: input.specId,
            revisionNumber: input.revisionNumber,
            originalAssetId: input.originalAssetId,
            model: input.model,
            artBibleVersion: input.artBibleVersion,
            imageRouteVersion: input.imageRouteVersion,
            requestSnapshot: input.requestSnapshot,
            verdictSnapshot: input.verdictSnapshot,
          })
          .onConflictDoNothing({ target: illustrationRevisions.id });

        // Upsert the publication → approved, pointing at the new revision.
        await tx
          .insert(illustrationPublications)
          .values({
            id: input.publicationId,
            familyId: input.familyId,
            storyId: input.storyId,
            specId: input.specId,
            state: "approved",
            revisionId: input.revisionId,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: illustrationPublications.specId,
            set: {
              state: "approved",
              revisionId: input.revisionId,
              updatedAt: now,
            },
          });
      });
    },

    async setPublicationState({ familyId, storyId, specId, state }) {
      await db
        .insert(illustrationPublications)
        .values({ familyId, storyId, specId, state })
        .onConflictDoUpdate({
          target: illustrationPublications.specId,
          set: { state, updatedAt: new Date() },
        });
    },

    async getPublicationState(
      familyId,
      specId,
    ): Promise<IllustrationState | null> {
      const [row] = await db
        .select({ state: illustrationPublications.state })
        .from(illustrationPublications)
        .where(
          and(
            eq(illustrationPublications.specId, specId),
            eq(illustrationPublications.familyId, familyId),
          ),
        )
        .limit(1);
      return row?.state ?? null;
    },

    async getDeliverable(
      familyId,
      specId,
    ): Promise<DeliverableIllustration | null> {
      // Gate on an APPROVED publication first — nothing else is deliverable.
      const [pub] = await db
        .select({
          state: illustrationPublications.state,
          revisionId: illustrationPublications.revisionId,
        })
        .from(illustrationPublications)
        .where(
          and(
            eq(illustrationPublications.specId, specId),
            eq(illustrationPublications.familyId, familyId),
            eq(illustrationPublications.state, "approved"),
          ),
        )
        .limit(1);
      if (!pub?.revisionId) return null;

      const [revision] = await db
        .select({ originalAssetId: illustrationRevisions.originalAssetId })
        .from(illustrationRevisions)
        .where(eq(illustrationRevisions.id, pub.revisionId))
        .limit(1);
      if (!revision) return null;

      // ADR-007: deliver the approved ORIGINAL directly (no derivatives exist).
      const [original] = await db
        .select({
          storageKey: illustrationAssets.storageKey,
          contentType: illustrationAssets.contentType,
        })
        .from(illustrationAssets)
        .where(
          and(
            eq(illustrationAssets.id, revision.originalAssetId),
            eq(illustrationAssets.state, "approved"),
          ),
        )
        .limit(1);
      return original ?? null;
    },
  };
}

/** Convenience factory resolving the process database first (mirrors siblings). */
export async function getIllustrationRepository(): Promise<IllustrationRepository> {
  const { getDb } = await import("../client");
  const { createIllustrationRepository: make } =
    await import("./illustration-repository");
  return make(await getDb());
}
