import { and, desc, eq, inArray } from "drizzle-orm";

import type {
  PublishOneOffInput,
  ReadingProgress,
  SaveReadingProgressInput,
  StoryLifecycleStatus,
  StoryPreferences,
  StoryPreferencesPatch,
  StoryReaderView,
  StoryRecord,
  StoryRepository,
  StorySummary,
} from "@/application/ports/story-repository";
import { DEFAULT_STORY_PREFERENCES } from "@/application/ports/story-repository";
import { nameBasedUuid } from "@/domain/name-uuid";
import type { Database } from "../client";
import {
  chapterPublications,
  chapterRevisions,
  chapters,
  illustrationSpecs,
  readingProgress,
  stories,
  storyPreferences,
} from "../schema";

/**
 * Drizzle implementation of {@link StoryRepository}. Only this layer knows the
 * table shape. The publication method is the ONE-TRANSACTION publish gate
 * (`docs/03-ai/orchestration.md` "Publication transaction"), idempotent via
 * deterministic name-based ids. Reader reads are constrained to `published`
 * stories with an `accepted` current revision, so rejected/superseded/blocked
 * content is unreachable through the reader path (domain rule 9), proven by tests.
 */

type PrefRow = typeof storyPreferences.$inferSelect;
type StoryRow = typeof stories.$inferSelect;

function toPreferences(row: PrefRow): StoryPreferences {
  return {
    readingAge: row.readingAge,
    maxSuspense: row.maxSuspense,
    allowMildPeril: row.allowMildPeril,
    allowDeathGrief: row.allowDeathGrief,
    allowRealFamilyMembers: row.allowRealFamilyMembers,
    allowFictionaliseSchoolHome: row.allowFictionaliseSchoolHome,
    excludedTopics: row.excludedTopics,
  };
}

function toStory(row: StoryRow): StoryRecord {
  return {
    id: row.id,
    familyId: row.familyId,
    userId: row.userId,
    type: row.type,
    status: row.status,
    title: row.title ?? null,
    createdAt: row.createdAt,
    publishedAt: row.publishedAt ?? null,
  };
}

export function createStoryRepository(db: Database): StoryRepository {
  return {
    async createStoryIfAbsent({ id, familyId, userId, type }) {
      const inserted = await db
        .insert(stories)
        .values({ id, familyId, userId, type, status: "generating" })
        .onConflictDoNothing({ target: stories.id })
        .returning();
      return { created: inserted.length > 0 };
    },

    async getStory(familyId, storyId) {
      const [row] = await db
        .select()
        .from(stories)
        .where(and(eq(stories.id, storyId), eq(stories.familyId, familyId)))
        .limit(1);
      return row ? toStory(row) : null;
    },

    async getStoryPreferences(familyId) {
      const [row] = await db
        .select()
        .from(storyPreferences)
        .where(eq(storyPreferences.familyId, familyId))
        .limit(1);
      return row ? toPreferences(row) : { ...DEFAULT_STORY_PREFERENCES };
    },

    async ensureStoryPreferences(familyId) {
      const [existing] = await db
        .select()
        .from(storyPreferences)
        .where(eq(storyPreferences.familyId, familyId))
        .limit(1);
      if (existing) return toPreferences(existing);

      const [created] = await db
        .insert(storyPreferences)
        .values({ familyId })
        .onConflictDoNothing({ target: storyPreferences.familyId })
        .returning();
      if (created) return toPreferences(created);

      // A concurrent insert won — read it back.
      const [row] = await db
        .select()
        .from(storyPreferences)
        .where(eq(storyPreferences.familyId, familyId))
        .limit(1);
      return row ? toPreferences(row) : { ...DEFAULT_STORY_PREFERENCES };
    },

    async updateStoryPreferences(familyId, patch: StoryPreferencesPatch) {
      await db
        .insert(storyPreferences)
        .values({ familyId, ...patch })
        .onConflictDoUpdate({
          target: storyPreferences.familyId,
          set: { ...patch, updatedAt: new Date() },
        });
      const [row] = await db
        .select()
        .from(storyPreferences)
        .where(eq(storyPreferences.familyId, familyId))
        .limit(1);
      return row ? toPreferences(row) : { ...DEFAULT_STORY_PREFERENCES };
    },

    async setStoryStatus(familyId, storyId, status: StoryLifecycleStatus) {
      await db
        .update(stories)
        .set({ status, updatedAt: new Date() })
        .where(and(eq(stories.id, storyId), eq(stories.familyId, familyId)));
    },

    async publishOneOffChapter(input: PublishOneOffInput) {
      const now = input.now ?? new Date();
      const chapterId = await nameBasedUuid("one-off-chapter", input.storyId);
      const revisionId = await nameBasedUuid(
        "one-off-revision",
        input.workflowId,
        "publish",
      );
      const publicationId = await nameBasedUuid(
        "one-off-publication",
        chapterId,
      );
      const specIds = await Promise.all(
        input.illustrationSpecs.map((s) =>
          nameBasedUuid("illustration-spec", revisionId, s.anchorKey),
        ),
      );

      await db.transaction(async (tx) => {
        await tx
          .insert(chapters)
          .values({
            id: chapterId,
            storyId: input.storyId,
            familyId: input.familyId,
            chapterNumber: 1,
          })
          .onConflictDoNothing({ target: chapters.id });

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
          .onConflictDoNothing({ target: chapterRevisions.id });

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

        await tx
          .update(stories)
          .set({
            status: "published",
            title: input.title,
            publishedAt: now,
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

    async getStoryReader(familyId, userId, storyId) {
      const [story] = await db
        .select()
        .from(stories)
        .where(
          and(
            eq(stories.id, storyId),
            eq(stories.familyId, familyId),
            eq(stories.status, "published"),
          ),
        )
        .limit(1);
      if (!story) return null;

      const [chapter] = await db
        .select()
        .from(chapters)
        .where(
          and(eq(chapters.storyId, storyId), eq(chapters.chapterNumber, 1)),
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
        .orderBy(illustrationSpecs.orderIndex);

      const [progress] = await db
        .select()
        .from(readingProgress)
        .where(
          and(
            eq(readingProgress.storyId, storyId),
            eq(readingProgress.userId, userId),
          ),
        )
        .limit(1);

      const view: StoryReaderView = {
        storyId: story.id,
        chapterId: chapter.id,
        title: revision.title,
        paragraphs: revision.bodyParagraphs,
        illustrations: specs.map((s) => ({
          anchorKey: s.anchorKey,
          afterParagraph: s.afterParagraph,
          caption: s.caption,
          aspect: s.aspect,
        })),
        progress: progress
          ? {
              scrollProportion: progress.scrollProportion,
              paragraphAnchor: progress.paragraphAnchor,
              completed: progress.completed,
            }
          : null,
      };
      return view;
    },

    async listLibrary(familyId) {
      const rows = await db
        .select()
        .from(stories)
        .where(
          and(
            eq(stories.familyId, familyId),
            // Reader-facing lists never surface blocked/failed stories.
            inArray(stories.status, ["published", "generating"]),
          ),
        )
        .orderBy(desc(stories.updatedAt));
      return rows.map((row): StorySummary => ({
        id: row.id,
        title: row.title ?? null,
        status: row.status,
        updatedAt: row.updatedAt,
        publishedAt: row.publishedAt ?? null,
      }));
    },

    async saveReadingProgress(input: SaveReadingProgressInput) {
      const now = input.now ?? new Date();
      await db
        .insert(readingProgress)
        .values({
          storyId: input.storyId,
          familyId: input.familyId,
          userId: input.userId,
          chapterId: input.chapterId,
          scrollProportion: input.scrollProportion,
          paragraphAnchor: input.paragraphAnchor,
          completed: input.completed,
          lastReadAt: now,
        })
        .onConflictDoUpdate({
          target: [readingProgress.storyId, readingProgress.userId],
          set: {
            scrollProportion: input.scrollProportion,
            paragraphAnchor: input.paragraphAnchor,
            completed: input.completed,
            lastReadAt: now,
            updatedAt: now,
          },
        });
    },

    async getReadingProgress(familyId, userId, storyId) {
      const [row] = await db
        .select()
        .from(readingProgress)
        .where(
          and(
            eq(readingProgress.storyId, storyId),
            eq(readingProgress.familyId, familyId),
            eq(readingProgress.userId, userId),
          ),
        )
        .limit(1);
      if (!row) return null;
      const progress: ReadingProgress = {
        scrollProportion: row.scrollProportion,
        paragraphAnchor: row.paragraphAnchor,
        completed: row.completed,
      };
      return progress;
    },
  };
}

/** Convenience factory resolving the process database first (mirrors siblings). */
export async function getStoryRepository(): Promise<StoryRepository> {
  const { getDb } = await import("../client");
  return createStoryRepository(await getDb());
}
