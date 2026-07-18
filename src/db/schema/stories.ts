import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import type { OneOffPlan } from "@/domain/story-draft";
import type {
  ReviewArtifact,
  ReviewDecisionKind,
} from "@/domain/review-policy";
import { families } from "./families";
import { users } from "./auth";

/**
 * STORY tables (`docs/05-backend/database.md` "Stories";
 * `docs/02-storytelling/one-off-stories.md`, `docs/02-storytelling/story-reader.md`).
 * Shaped one-off-first but SERIES-READY: a one-off story is exactly one chapter
 * (`type = 'one_off'`, one `chapters` row, `chapter_number = 1`); series (M8) add
 * more chapters and a series bible. Published chapters are IMMUTABLE revisions
 * (domain rule 5); rejected content is NEVER returned by reader queries
 * (domain rule 9) — enforced by the accepted-revision constraints below plus the
 * query services.
 */

export const storyType = pgEnum("story_type", ["one_off", "series"]);

/**
 * A story's lifecycle. `generating` while its workflow runs; `published` once the
 * text publication transaction commits; `blocked` when the safety policy rejects
 * it (nothing publishable persists); `failed` when generation could not complete
 * (resumable / safe retry). Only `published` stories are reader-visible.
 */
export const storyStatus = pgEnum("story_status", [
  "generating",
  "published",
  "blocked",
  "failed",
]);

/** A revision's status. At most one `accepted` revision per chapter (partial unique). */
export const chapterRevisionStatus = pgEnum("chapter_revision_status", [
  "accepted",
  "superseded",
  "rejected",
]);

export const illustrationAspect = pgEnum("illustration_aspect", [
  "portrait",
  "landscape",
  "square",
]);

export const readingAgeBand = pgEnum("reading_age_band", [
  "3-4",
  "5-7",
  "8-10",
]);

export const suspenseLevel = pgEnum("suspense_level", [
  "calm",
  "mild",
  "adventurous",
]);

export const stories = pgTable(
  "stories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: storyType("type").notNull().default("one_off"),
    status: storyStatus("status").notNull().default("generating"),
    /** Set from the accepted plan on publication; null while generating. */
    title: varchar("title", { length: 160 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (table) => [
    index("stories_family_idx").on(table.familyId),
    index("stories_family_status_idx").on(table.familyId, table.status),
  ],
);

export const chapters = pgTable(
  "chapters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storyId: uuid("story_id")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    /** 1 for a one-off; series chapters increment (M8). */
    chapterNumber: integer("chapter_number").notNull().default(1),
    /** The current accepted revision (circular FK, set-null on delete). */
    currentRevisionId: uuid("current_revision_id").references(
      (): AnyPgColumn => chapterRevisions.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // One chapter per (story, number). Series next-chapter uniqueness rides this.
    unique("chapters_story_number_unq").on(table.storyId, table.chapterNumber),
    index("chapters_story_idx").on(table.storyId),
  ],
);

export const chapterRevisions = pgTable(
  "chapter_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chapterId: uuid("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    storyId: uuid("story_id")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    revisionNumber: integer("revision_number").notNull(),
    status: chapterRevisionStatus("status").notNull().default("accepted"),
    title: varchar("title", { length: 160 }).notNull(),
    /** Immutable published prose (the story body). */
    bodyParagraphs: jsonb("body_paragraphs").$type<string[]>().notNull(),
    wordCount: integer("word_count").notNull(),
    schemaVersion: text("schema_version").notNull(),
    /** The validated plan this revision realised (domain snapshot, not raw output). */
    planSnapshot: jsonb("plan_snapshot").$type<OneOffPlan>().notNull(),
    /** The advisory review + the app policy decision that accepted it. */
    reviewSnapshot: jsonb("review_snapshot").$type<{
      review: ReviewArtifact;
      decision: ReviewDecisionKind;
      revisionsUsed: number;
    }>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Immutable revision history: one row per (chapter, revision number)
    // (`docs/05-backend/database.md` UNIQUE(series_id, chapter_number, revision_number)).
    unique("chapter_revisions_chapter_revision_unq").on(
      table.chapterId,
      table.revisionNumber,
    ),
    // At most ONE accepted revision per chapter — a PARTIAL unique index
    // (`docs/05-backend/database.md`: "Use partial unique indexes … for one
    // accepted revision per chapter").
    uniqueIndex("chapter_revisions_one_accepted_per_chapter")
      .on(table.chapterId)
      .where(sql`${table.status} = 'accepted'`),
    index("chapter_revisions_chapter_idx").on(table.chapterId),
  ],
);

export const chapterPublications = pgTable(
  "chapter_publications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chapterId: uuid("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    storyId: uuid("story_id")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => chapterRevisions.id, { onDelete: "cascade" }),
    publishedAt: timestamp("published_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // One publication per chapter (a one-off has exactly one; a series chapter
    // publishes once — a re-publish is a new accepted revision, same chapter).
    unique("chapter_publications_chapter_unq").on(table.chapterId),
    index("chapter_publications_story_idx").on(table.storyId),
  ],
);

export const illustrationSpecs = pgTable(
  "illustration_specs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storyId: uuid("story_id")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    chapterId: uuid("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => chapterRevisions.id, { onDelete: "cascade" }),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    /** The draft illustration-anchor key this spec plans for. */
    anchorKey: varchar("anchor_key", { length: 80 }).notNull(),
    orderIndex: integer("order_index").notNull(),
    /** Insert AFTER this paragraph index in the published body. */
    afterParagraph: integer("after_paragraph").notNull(),
    caption: varchar("caption", { length: 240 }).notNull(),
    sceneDescription: text("scene_description").notNull(),
    aspect: illustrationAspect("aspect").notNull(),
    schemaVersion: text("schema_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // One spec per (revision, anchor) — the idempotency anchor for re-records.
    unique("illustration_specs_revision_anchor_unq").on(
      table.revisionId,
      table.anchorKey,
    ),
    index("illustration_specs_story_idx").on(table.storyId),
    index("illustration_specs_chapter_idx").on(table.chapterId),
  ],
);

export const storyPreferences = pgTable(
  "story_preferences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    // Parent safety configuration (`safety-age-appropriateness.md` "Parent config").
    readingAge: readingAgeBand("reading_age").notNull().default("5-7"),
    maxSuspense: suspenseLevel("max_suspense").notNull().default("mild"),
    allowMildPeril: boolean("allow_mild_peril").notNull().default(true),
    allowDeathGrief: boolean("allow_death_grief").notNull().default(false),
    allowRealFamilyMembers: boolean("allow_real_family_members")
      .notNull()
      .default(false),
    allowFictionaliseSchoolHome: boolean("allow_fictionalise_school_home")
      .notNull()
      .default(true),
    excludedTopics: jsonb("excluded_topics")
      .$type<string[]>()
      .notNull()
      .default([]),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // One preferences row per family (family-level parent configuration).
    unique("story_preferences_family_unq").on(table.familyId),
  ],
);

export const readingProgress = pgTable(
  "reading_progress",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storyId: uuid("story_id")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /**
     * The chapter this progress row tracks. NOT NULL: a one-off story has exactly
     * one chapter and a series read always targets a specific chapter, so every
     * progress row belongs to a concrete chapter (the port types `chapterId` as
     * required). Per-chapter granularity lets a series keep independent positions
     * for each chapter (M8 deferred item). Cascades with the chapter (which itself
     * cascades with the story).
     */
    chapterId: uuid("chapter_id")
      .notNull()
      .references(() => chapters.id, {
        onDelete: "cascade",
      }),
    /** Scroll proportion 0..1 through the reader. */
    scrollProportion: real("scroll_proportion").notNull().default(0),
    /** The paragraph anchor last in view (survives refresh). */
    paragraphAnchor: integer("paragraph_anchor").notNull().default(0),
    completed: boolean("completed").notNull().default(false),
    lastReadAt: timestamp("last_read_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // One progress row per (story, chapter, reader). A one-off resolves its single
    // chapter, so this stays a single row per (story, reader) exactly as before; a
    // series keeps an independent position per chapter. `chapter_id` is NOT NULL, so
    // there are no NULL rows to make distinct — a plain composite unique is enough
    // (no coalesced/partial index needed).
    unique("reading_progress_story_chapter_user_unq").on(
      table.storyId,
      table.chapterId,
      table.userId,
    ),
    index("reading_progress_family_idx").on(table.familyId),
  ],
);
