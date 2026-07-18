import { and, desc, eq, ne } from "drizzle-orm";

import type {
  ApproveCandidateSetInput,
  RecordCandidateSetInput,
  VisualAssetRepository,
} from "@/application/ports/visual-asset-repository";
import { orderByReferenceView } from "@/domain/reference-view";
import type {
  CandidateAssetSummary,
  CandidateSet,
  ReferenceAsset,
  VisualAsset,
  VisualAssetState,
  VisualProfile,
} from "@/domain/visual-asset";
import type { Database } from "../client";
import {
  characterReferenceAssets,
  childCharacters,
  visualAssets,
  visualProfiles,
} from "../schema";

/**
 * Drizzle implementation of {@link VisualAssetRepository}. Only this layer knows
 * the table shape; it maps rows to pure domain types (AGENTS.md). Every query is
 * filtered by BOTH `family_id` AND `character_id`, so a guessed asset/candidate
 * id from another family — or another character — resolves to nothing.
 */

type AssetRow = typeof visualAssets.$inferSelect;
type ProfileRow = typeof visualProfiles.$inferSelect;

function toAsset(row: AssetRow): VisualAsset {
  return {
    id: row.id,
    familyId: row.familyId,
    characterId: row.characterId,
    candidateSetId: row.candidateSetId,
    view: row.view,
    state: row.state,
    storageKey: row.storageKey,
    contentType: row.contentType,
    checksum: row.checksum,
    byteSize: row.byteSize,
    width: row.width,
    height: row.height,
    model: row.model,
    seed: row.seed,
    visualProfileId: row.visualProfileId,
    createdAt: row.createdAt,
    reviewedAt: row.reviewedAt ?? undefined,
  };
}

function toProfile(row: ProfileRow): VisualProfile {
  return {
    id: row.id,
    familyId: row.familyId,
    characterId: row.characterId,
    version: row.version,
    artBibleVersion: row.artBibleVersion,
    createdAt: row.createdAt,
    approvedAt: row.approvedAt,
  };
}

/** Group a character's assets into candidate sets, ordered by canonical view. */
function groupIntoSets(characterId: string, rows: AssetRow[]): CandidateSet[] {
  const bySet = new Map<string, { createdAt: Date; assets: AssetRow[] }>();
  for (const row of rows) {
    const entry = bySet.get(row.candidateSetId);
    if (entry) {
      entry.assets.push(row);
      if (row.createdAt < entry.createdAt) entry.createdAt = row.createdAt;
    } else {
      bySet.set(row.candidateSetId, {
        createdAt: row.createdAt,
        assets: [row],
      });
    }
  }
  return [...bySet.entries()]
    .map(([id, entry]): CandidateSet => {
      const assets: CandidateAssetSummary[] = orderByReferenceView(
        entry.assets,
      ).map((a) => ({ id: a.id, view: a.view, state: a.state }));
      return { id, characterId, createdAt: entry.createdAt, assets };
    })
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

export function createVisualAssetRepository(
  db: Database,
): VisualAssetRepository {
  return {
    async getLatestVisualProfileVersion(familyId, characterId) {
      const [latest] = await db
        .select({ version: visualProfiles.version })
        .from(visualProfiles)
        .where(
          and(
            eq(visualProfiles.familyId, familyId),
            eq(visualProfiles.characterId, characterId),
          ),
        )
        .orderBy(desc(visualProfiles.version))
        .limit(1);
      return latest?.version ?? 0;
    },

    async recordCandidateSet(input: RecordCandidateSetInput) {
      const rows = await db
        .insert(visualAssets)
        .values(
          input.assets.map((asset) => ({
            id: asset.id,
            familyId: input.familyId,
            characterId: input.characterId,
            candidateSetId: input.candidateSetId,
            view: asset.view,
            state: "quarantined" as const,
            storageKey: asset.storageKey,
            contentType: asset.contentType,
            checksum: asset.checksum,
            byteSize: asset.byteSize,
            width: asset.width,
            height: asset.height,
            model: asset.model,
            seed: asset.seed,
          })),
        )
        .returning();
      return groupIntoSets(input.characterId, rows)[0];
    },

    async listCandidateSetsByState(
      familyId,
      characterId,
      state: VisualAssetState,
    ) {
      const rows = await db
        .select()
        .from(visualAssets)
        .where(
          and(
            eq(visualAssets.familyId, familyId),
            eq(visualAssets.characterId, characterId),
            eq(visualAssets.state, state),
          ),
        );
      return groupIntoSets(characterId, rows);
    },

    async getAsset(familyId, characterId, assetId) {
      const [row] = await db
        .select()
        .from(visualAssets)
        .where(
          and(
            eq(visualAssets.id, assetId),
            eq(visualAssets.familyId, familyId),
            eq(visualAssets.characterId, characterId),
          ),
        )
        .limit(1);
      return row ? toAsset(row) : null;
    },

    async approveCandidateSet(input: ApproveCandidateSetInput) {
      return db.transaction(async (tx) => {
        // The set must be a QUARANTINED set of this character in this family.
        const quarantined = await tx
          .select()
          .from(visualAssets)
          .where(
            and(
              eq(visualAssets.familyId, input.familyId),
              eq(visualAssets.characterId, input.characterId),
              eq(visualAssets.candidateSetId, input.candidateSetId),
              eq(visualAssets.state, "quarantined"),
            ),
          )
          .for("update");
        if (quarantined.length === 0) return null;

        // Next immutable version = (current max for this character) + 1.
        const [latest] = await tx
          .select({ version: visualProfiles.version })
          .from(visualProfiles)
          .where(eq(visualProfiles.characterId, input.characterId))
          .orderBy(desc(visualProfiles.version))
          .limit(1);
        const nextVersion = (latest?.version ?? 0) + 1;

        const now = new Date();
        const [profile] = await tx
          .insert(visualProfiles)
          .values({
            familyId: input.familyId,
            characterId: input.characterId,
            version: nextVersion,
            artBibleVersion: input.artBibleVersion,
            approvedAt: now,
          })
          .returning();

        // Approve exactly this set's assets and attach them to the new profile.
        await tx
          .update(visualAssets)
          .set({
            state: "approved",
            visualProfileId: profile.id,
            reviewedAt: now,
          })
          .where(
            and(
              eq(visualAssets.familyId, input.familyId),
              eq(visualAssets.characterId, input.characterId),
              eq(visualAssets.candidateSetId, input.candidateSetId),
              eq(visualAssets.state, "quarantined"),
            ),
          );

        // Link the ordered reference set.
        await tx.insert(characterReferenceAssets).values(
          input.orderedAssets.map((asset) => ({
            familyId: input.familyId,
            visualProfileId: profile.id,
            assetId: asset.assetId,
            view: asset.view,
            position: asset.position,
          })),
        );

        // Reject every OTHER quarantined set for this character — the parent chose
        // this one, so the alternatives are superseded and must stay unreachable.
        await tx
          .update(visualAssets)
          .set({ state: "rejected", reviewedAt: now })
          .where(
            and(
              eq(visualAssets.familyId, input.familyId),
              eq(visualAssets.characterId, input.characterId),
              eq(visualAssets.state, "quarantined"),
              ne(visualAssets.candidateSetId, input.candidateSetId),
            ),
          );

        // Repoint the character at its new current visual profile.
        await tx
          .update(childCharacters)
          .set({ visualProfileId: profile.id, updatedAt: now })
          .where(
            and(
              eq(childCharacters.id, input.characterId),
              eq(childCharacters.familyId, input.familyId),
            ),
          );

        return toProfile(profile);
      });
    },

    async rejectCandidateSet({ familyId, characterId, candidateSetId }) {
      const rejected = await db
        .update(visualAssets)
        .set({ state: "rejected", reviewedAt: new Date() })
        .where(
          and(
            eq(visualAssets.familyId, familyId),
            eq(visualAssets.characterId, characterId),
            eq(visualAssets.candidateSetId, candidateSetId),
            eq(visualAssets.state, "quarantined"),
          ),
        )
        .returning({ id: visualAssets.id });
      return rejected.length > 0;
    },

    async getApprovedReferenceSet(
      familyId,
      characterId,
    ): Promise<ReferenceAsset[]> {
      const [character] = await db
        .select({ visualProfileId: childCharacters.visualProfileId })
        .from(childCharacters)
        .where(
          and(
            eq(childCharacters.id, characterId),
            eq(childCharacters.familyId, familyId),
          ),
        )
        .limit(1);
      if (!character?.visualProfileId) return [];

      const rows = await db
        .select({
          id: visualAssets.id,
          view: characterReferenceAssets.view,
          position: characterReferenceAssets.position,
          state: visualAssets.state,
        })
        .from(characterReferenceAssets)
        .innerJoin(
          visualAssets,
          eq(characterReferenceAssets.assetId, visualAssets.id),
        )
        .where(
          and(
            eq(
              characterReferenceAssets.visualProfileId,
              character.visualProfileId,
            ),
            eq(characterReferenceAssets.familyId, familyId),
            // Defence in depth: only ever surface approved assets.
            eq(visualAssets.state, "approved"),
          ),
        )
        .orderBy(characterReferenceAssets.position);

      return rows.map((row) => ({
        id: row.id,
        view: row.view,
        position: row.position,
      }));
    },
  };
}

/** Convenience factory resolving the process database first (mirrors siblings). */
export async function getVisualAssetRepository(): Promise<VisualAssetRepository> {
  const { getDb } = await import("../client");
  return createVisualAssetRepository(await getDb());
}
