import { and, asc, desc, eq, sql } from "drizzle-orm";

import type {
  PersistSeriesBibleInput,
  PublishSeriesChapterInput,
  SeriesChapterReaderView,
  SeriesContext,
  SeriesReaderOverview,
  SeriesRepository,
} from "@/application/ports/series-repository";
import { nameBasedUuid } from "@/domain/name-uuid";
import type { Database } from "../client";
import {
  chapterBlueprints,
  chapterPublications,
  chapterRevisions,
  chapters,
  continuitySnapshots,
  illustrationSpecs,
  plotThreadStates,
  plotThreads,
  readingProgress,
  seriesBibles,
  stories,
} from "../schema";

/**
 * Drizzle implementation of {@link SeriesRepository}. Only this layer knows the
 * table shape. {@link SeriesRepository.publishSeriesChapter} is the ONE-TRANSACTION
 * publish gate (`orchestration.md` "Publication transaction") — accepted revision +
 * NEW immutable snapshot + plot-thread states + publication + advance — made
 * idempotent by deterministic name-based ids and made safe against concurrent
 * next-chapter requests by an advisory lock PLUS the DB constraints (the partial-
 * unique-accepted revision index and the one-snapshot-per-chapter unique index).
 * Reader reads are spoiler-free and constrained to accepted/published content
 * (domain rule 9).
 */

/** A stable signed-int32 key from a UUID string, for the advisory lock. */
function advisoryKeyFor(storyId: string): number {
  let hash = 0;
  for (let i = 0; i < storyId.length; i++) {
    hash = (Math.imul(hash, 31) + storyId.charCodeAt(i)) | 0;
  }
  return hash;
}

export function createSeriesRepository(db: Database): SeriesRepository {
  return {
    async persistSeriesBible(input: PersistSeriesBibleInput) {
      const now = input.now ?? new Date();
      const bibleId = await nameBasedUuid("series-bible", input.storyId);
      const snapshotId = await nameBasedUuid(
        "continuity-snapshot",
        input.storyId,
        "0",
      );
      const blueprintIds = await Promise.all(
        input.bible.chapterBlueprints.map((b) =>
          nameBasedUuid(
            "chapter-blueprint",
            input.storyId,
            String(b.chapterNumber),
          ),
        ),
      );
      const threadIds = await Promise.all(
        input.bible.plotThreads.map((t) =>
          nameBasedUuid("plot-thread", input.storyId, t.threadKey),
        ),
      );

      await db.transaction(async (tx) => {
        await tx
          .insert(seriesBibles)
          .values({
            id: bibleId,
            storyId: input.storyId,
            familyId: input.familyId,
            schemaVersion: input.schemaVersion,
            title: input.bible.title,
            spoilerFreePremise: input.bible.spoilerFreePremise,
            chapterCount: input.bible.chapterCount,
            bible: input.bible,
            storyDna: input.storyDna,
            pinnedRouteProfile: input.pinnedRouteProfile,
            pinnedPromptVersions: input.pinnedPromptVersions,
            pinnedSchemaVersions: input.pinnedSchemaVersions,
            pinnedVisualProfiles: input.pinnedVisualProfiles,
          })
          .onConflictDoNothing({ target: seriesBibles.storyId });

        for (let i = 0; i < input.bible.chapterBlueprints.length; i++) {
          const blueprint = input.bible.chapterBlueprints[i];
          await tx
            .insert(chapterBlueprints)
            .values({
              id: blueprintIds[i],
              storyId: input.storyId,
              familyId: input.familyId,
              chapterNumber: blueprint.chapterNumber,
              blueprint,
            })
            .onConflictDoNothing({
              target: [
                chapterBlueprints.storyId,
                chapterBlueprints.chapterNumber,
              ],
            });
        }

        for (let i = 0; i < input.bible.plotThreads.length; i++) {
          const thread = input.bible.plotThreads[i];
          await tx
            .insert(plotThreads)
            .values({
              id: threadIds[i],
              storyId: input.storyId,
              familyId: input.familyId,
              threadKey: thread.threadKey,
              description: thread.description,
              introduceInChapter: thread.introduceInChapter,
              resolveInChapter: thread.resolveInChapter,
            })
            .onConflictDoNothing({
              target: [plotThreads.storyId, plotThreads.threadKey],
            });
        }

        await tx
          .insert(continuitySnapshots)
          .values({
            id: snapshotId,
            storyId: input.storyId,
            familyId: input.familyId,
            afterChapterNumber: 0,
            state: input.initialContinuity,
          })
          .onConflictDoNothing({
            target: [
              continuitySnapshots.storyId,
              continuitySnapshots.afterChapterNumber,
            ],
          });

        await tx
          .update(stories)
          .set({ title: input.bible.title, updatedAt: now })
          .where(
            and(
              eq(stories.id, input.storyId),
              eq(stories.familyId, input.familyId),
            ),
          );
      });
    },

    async hasAcceptedBible(storyId) {
      const [row] = await db
        .select({ id: seriesBibles.id })
        .from(seriesBibles)
        .where(eq(seriesBibles.storyId, storyId))
        .limit(1);
      return Boolean(row);
    },

    async getSeriesContext(storyId): Promise<SeriesContext | null> {
      const [bibleRow] = await db
        .select()
        .from(seriesBibles)
        .where(eq(seriesBibles.storyId, storyId))
        .limit(1);
      if (!bibleRow) return null;

      const accepted = await db
        .select({ n: chapterRevisions.id })
        .from(chapterRevisions)
        .where(
          and(
            eq(chapterRevisions.storyId, storyId),
            eq(chapterRevisions.status, "accepted"),
          ),
        );

      const [snapshotRow] = await db
        .select()
        .from(continuitySnapshots)
        .where(eq(continuitySnapshots.storyId, storyId))
        .orderBy(desc(continuitySnapshots.afterChapterNumber))
        .limit(1);
      if (!snapshotRow) return null;

      return {
        storyId,
        bible: bibleRow.bible,
        storyDna: bibleRow.storyDna,
        pinnedRouteProfile: bibleRow.pinnedRouteProfile,
        pinnedPromptVersions: bibleRow.pinnedPromptVersions,
        chapterCount: bibleRow.chapterCount,
        acceptedChapterCount: accepted.length,
        latestSnapshot: snapshotRow.state,
      };
    },

    async publishSeriesChapter(input: PublishSeriesChapterInput) {
      const now = input.now ?? new Date();
      const chapterId = await nameBasedUuid(
        "series-chapter",
        input.storyId,
        String(input.chapterNumber),
      );
      const revisionId = await nameBasedUuid("series-revision", chapterId, "1");
      const publicationId = await nameBasedUuid(
        "series-publication",
        chapterId,
      );
      const snapshotId = await nameBasedUuid(
        "continuity-snapshot",
        input.storyId,
        String(input.chapterNumber),
      );
      const specIds = await Promise.all(
        input.illustrationSpecs.map((s) =>
          nameBasedUuid("illustration-spec", revisionId, s.anchorKey),
        ),
      );
      const threadStateIds = await Promise.all(
        input.threadStates.map((t) =>
          nameBasedUuid(
            "plot-thread-state",
            input.storyId,
            t.threadKey,
            String(input.chapterNumber),
          ),
        ),
      );

      await db.transaction(async (tx) => {
        // Advisory lock on (story, chapter): serialize concurrent publishes of the
        // SAME chapter number. Correctness also rests on the constraints below.
        await tx.execute(
          sql`select pg_advisory_xact_lock(${advisoryKeyFor(input.storyId)}, ${input.chapterNumber})`,
        );

        await tx
          .insert(chapters)
          .values({
            id: chapterId,
            storyId: input.storyId,
            familyId: input.familyId,
            chapterNumber: input.chapterNumber,
          })
          .onConflictDoNothing({ target: chapters.id });

        // Deterministic revisionId + the partial-unique-accepted index collapse a
        // concurrent second publish of this chapter onto ONE accepted revision.
        await tx
          .insert(chapterRevisions)
          .values({
            id: revisionId,
            chapterId,
            storyId: input.storyId,
            familyId: input.familyId,
            revisionNumber: 1,
            status: "accepted",
            title: input.title,
            bodyParagraphs: input.draftParagraphs,
            wordCount: input.wordCount,
            schemaVersion: input.schemaVersion,
            planSnapshot: input.plan,
            reviewSnapshot: input.review,
          })
          .onConflictDoNothing();

        await tx
          .update(chapters)
          .set({ currentRevisionId: revisionId })
          .where(eq(chapters.id, chapterId));

        await tx
          .insert(chapterPublications)
          .values({
            id: publicationId,
            chapterId,
            storyId: input.storyId,
            familyId: input.familyId,
            revisionId,
            publishedAt: now,
          })
          .onConflictDoNothing({ target: chapterPublications.chapterId });

        for (let i = 0; i < input.illustrationSpecs.length; i++) {
          const s = input.illustrationSpecs[i];
          await tx
            .insert(illustrationSpecs)
            .values({
              id: specIds[i],
              storyId: input.storyId,
              chapterId,
              revisionId,
              familyId: input.familyId,
              anchorKey: s.anchorKey,
              orderIndex: i,
              afterParagraph: s.afterParagraph,
              caption: s.caption,
              sceneDescription: s.sceneDescription,
              aspect: s.aspect,
              schemaVersion: s.schemaVersion,
            })
            .onConflictDoNothing({
              target: [
                illustrationSpecs.revisionId,
                illustrationSpecs.anchorKey,
              ],
            });
        }

        // The NEW immutable snapshot (one per chapter number, unique-guarded).
        await tx
          .insert(continuitySnapshots)
          .values({
            id: snapshotId,
            storyId: input.storyId,
            familyId: input.familyId,
            afterChapterNumber: input.chapterNumber,
            state: input.continuityState,
          })
          .onConflictDoNothing({
            target: [
              continuitySnapshots.storyId,
              continuitySnapshots.afterChapterNumber,
            ],
          });

        for (let i = 0; i < input.threadStates.length; i++) {
          const t = input.threadStates[i];
          await tx
            .insert(plotThreadStates)
            .values({
              id: threadStateIds[i],
              storyId: input.storyId,
              familyId: input.familyId,
              threadKey: t.threadKey,
              chapterNumber: input.chapterNumber,
              status: t.status,
            })
            .onConflictDoNothing({
              target: [
                plotThreadStates.storyId,
                plotThreadStates.threadKey,
                plotThreadStates.chapterNumber,
              ],
            });
        }

        await tx
          .update(stories)
          .set({
            status: "published",
            publishedAt: sql`coalesce(${stories.publishedAt}, ${now.toISOString()})`,
            updatedAt: now,
          })
          .where(
            and(
              eq(stories.id, input.storyId),
              eq(stories.familyId, input.familyId),
            ),
          );
      });

      return { chapterId, revisionId };
    },

    async getSeriesReaderOverview(
      familyId,
      storyId,
    ): Promise<SeriesReaderOverview | null> {
      const [story] = await db
        .select()
        .from(stories)
        .where(
          and(
            eq(stories.id, storyId),
            eq(stories.familyId, familyId),
            eq(stories.type, "series"),
          ),
        )
        .limit(1);
      if (!story || story.status === "blocked" || story.status === "failed") {
        return null;
      }

      const [bibleRow] = await db
        .select({
          title: seriesBibles.title,
          premise: seriesBibles.spoilerFreePremise,
          chapterCount: seriesBibles.chapterCount,
        })
        .from(seriesBibles)
        .where(eq(seriesBibles.storyId, storyId))
        .limit(1);
      if (!bibleRow) return null;

      // Published chapters = a chapter whose current revision is accepted.
      const rows = await db
        .select({
          chapterNumber: chapters.chapterNumber,
          title: chapterRevisions.title,
        })
        .from(chapters)
        .innerJoin(
          chapterRevisions,
          eq(chapters.currentRevisionId, chapterRevisions.id),
        )
        .where(
          and(
            eq(chapters.storyId, storyId),
            eq(chapterRevisions.status, "accepted"),
          ),
        )
        .orderBy(asc(chapters.chapterNumber));

      const published = rows.map((r) => ({
        chapterNumber: r.chapterNumber,
        title: r.title,
        published: true,
      }));
      const publishedCount = published.length;
      const nextChapterNumber =
        publishedCount < bibleRow.chapterCount ? publishedCount + 1 : null;

      return {
        storyId,
        title: bibleRow.title,
        premise: bibleRow.premise,
        chapterCount: bibleRow.chapterCount,
        chapters: published,
        publishedChapterCount: publishedCount,
        nextChapterNumber,
        isComplete: publishedCount >= bibleRow.chapterCount,
      };
    },

    async getSeriesChapterReader(
      familyId,
      userId,
      storyId,
      chapterNumber,
    ): Promise<SeriesChapterReaderView | null> {
      const [story] = await db
        .select()
        .from(stories)
        .where(
          and(
            eq(stories.id, storyId),
            eq(stories.familyId, familyId),
            eq(stories.type, "series"),
            eq(stories.status, "published"),
          ),
        )
        .limit(1);
      if (!story) return null;

      const [bibleRow] = await db
        .select({ chapterCount: seriesBibles.chapterCount })
        .from(seriesBibles)
        .where(eq(seriesBibles.storyId, storyId))
        .limit(1);
      if (!bibleRow) return null;

      const [chapter] = await db
        .select()
        .from(chapters)
        .where(
          and(
            eq(chapters.storyId, storyId),
            eq(chapters.chapterNumber, chapterNumber),
          ),
        )
        .limit(1);
      if (!chapter?.currentRevisionId) return null;

      const [revision] = await db
        .select()
        .from(chapterRevisions)
        .where(
          and(
            eq(chapterRevisions.id, chapter.currentRevisionId),
            eq(chapterRevisions.status, "accepted"),
          ),
        )
        .limit(1);
      if (!revision) return null;

      const specs = await db
        .select()
        .from(illustrationSpecs)
        .where(eq(illustrationSpecs.revisionId, revision.id))
        .orderBy(asc(illustrationSpecs.orderIndex));

      // The gentle tomorrow promise is designed to be child-facing (never a
      // spoiler): only the CURRENT chapter's promise, and only when a next chapter
      // exists in the plan.
      let tomorrowPromise: string | null = null;
      if (chapterNumber < bibleRow.chapterCount) {
        const [blueprintRow] = await db
          .select({ blueprint: chapterBlueprints.blueprint })
          .from(chapterBlueprints)
          .where(
            and(
              eq(chapterBlueprints.storyId, storyId),
              eq(chapterBlueprints.chapterNumber, chapterNumber),
            ),
          )
          .limit(1);
        tomorrowPromise = blueprintRow?.blueprint.tomorrowPromise ?? null;
      }

      const [nextChapter] = await db
        .select({ id: chapters.id })
        .from(chapters)
        .innerJoin(
          chapterRevisions,
          eq(chapters.currentRevisionId, chapterRevisions.id),
        )
        .where(
          and(
            eq(chapters.storyId, storyId),
            eq(chapters.chapterNumber, chapterNumber + 1),
            eq(chapterRevisions.status, "accepted"),
          ),
        )
        .limit(1);

      const [progress] = await db
        .select()
        .from(readingProgress)
        .where(
          and(
            eq(readingProgress.chapterId, chapter.id),
            eq(readingProgress.userId, userId),
          ),
        )
        .limit(1);

      return {
        storyId: story.id,
        chapterId: chapter.id,
        chapterNumber,
        chapterCount: bibleRow.chapterCount,
        title: revision.title,
        paragraphs: revision.bodyParagraphs,
        illustrations: specs.map((s) => ({
          anchorKey: s.anchorKey,
          afterParagraph: s.afterParagraph,
          caption: s.caption,
          aspect: s.aspect,
        })),
        tomorrowPromise,
        isFinalChapter: chapterNumber >= bibleRow.chapterCount,
        hasNextPublishedChapter: Boolean(nextChapter),
        progress: progress
          ? {
              scrollProportion: progress.scrollProportion,
              paragraphAnchor: progress.paragraphAnchor,
              completed: progress.completed,
            }
          : null,
      };
    },
  };
}

/** Convenience factory resolving the process database first (mirrors siblings). */
export async function getSeriesRepository(): Promise<SeriesRepository> {
  const { getDb } = await import("../client");
  const { createSeriesRepository: make } = await import("./series-repository");
  return make(await getDb());
}
