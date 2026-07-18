import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import type { ContinuityState } from "@/domain/continuity";
import type { ChapterBlueprint, SeriesBible } from "@/domain/series-bible";
import type { PinnedRouteProfile } from "@/domain/model-route";
import type { StoryDna } from "@/domain/story-dna";
import { families } from "./families";
import { stories } from "./stories";

/**
 * SERIES tables (`docs/05-backend/database.md` "Stories" + "Continuity";
 * `docs/02-storytelling/story-series.md`, `docs/02-storytelling/continuity.md`).
 * A series IS a `stories` row with `type = 'series'`; these tables add the
 * spoiler-bearing accepted bible, the per-chapter blueprints, the immutable
 * continuity snapshot chain, and the plot-thread lifecycle.
 *
 * Domain rules: the bible is planned COMPLETELY before Chapter 1 (rule 1);
 * continuity is structured canonical data (rule 2); models never write these
 * (rule 3) — the pipeline persists validated artifacts; snapshots are immutable
 * (rule 5); an existing series PINS prompt/schema/model-route/visual-profile
 * versions (rule 8) recorded on `series_bibles`. The hidden bible + future
 * blueprints NEVER reach a child-facing payload (`story-series.md` "Spoilers").
 */

export const plotThreadStatus = pgEnum("plot_thread_status", [
  "planned",
  "introduced",
  "developing",
  "resolved",
]);

export const seriesBibles = pgTable(
  "series_bibles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storyId: uuid("story_id")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    schemaVersion: text("schema_version").notNull(),
    /** Parent/reader-visible title. */
    title: varchar("title", { length: 160 }).notNull(),
    /** Parent/reader-visible premise (spoiler-free). */
    spoilerFreePremise: text("spoiler_free_premise").notNull(),
    chapterCount: integer("chapter_count").notNull(),
    /**
     * The full ACCEPTED bible — SPOILER-BEARING (internal synopsis, planned
     * ending, every future blueprint). Never returned to a child-facing payload.
     */
    bible: jsonb("bible").$type<SeriesBible>().notNull(),
    /**
     * The FIXED Story DNA for the whole series (`story-series.md` step 2). Built
     * deterministically at creation and pinned here so every chapter reuses the
     * same cast keys, reading constraints, and prohibited outcomes.
     */
    storyDna: jsonb("story_dna").$type<StoryDna>().notNull(),
    /**
     * PINNED versions at series creation (domain rule 8) — model-route versions,
     * prompt versions, wire-schema versions, and the character visual-profile
     * version ids current at creation. An existing series never drifts when the
     * active route / current visual profile later changes.
     */
    pinnedRouteProfile: jsonb("pinned_route_profile")
      .$type<PinnedRouteProfile>()
      .notNull(),
    pinnedPromptVersions: jsonb("pinned_prompt_versions")
      .$type<Record<string, string>>()
      .notNull(),
    pinnedSchemaVersions: jsonb("pinned_schema_versions")
      .$type<string[]>()
      .notNull(),
    /** characterId → the visual-profile version id current at creation. */
    pinnedVisualProfiles: jsonb("pinned_visual_profiles")
      .$type<Record<string, string>>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // One accepted bible per series (idempotent create anchor).
    unique("series_bibles_story_unq").on(table.storyId),
    index("series_bibles_family_idx").on(table.familyId),
  ],
);

export const chapterBlueprints = pgTable(
  "chapter_blueprints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storyId: uuid("story_id")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    chapterNumber: integer("chapter_number").notNull(),
    /** The full blueprint — SPOILER-BEARING; never child-facing. */
    blueprint: jsonb("blueprint").$type<ChapterBlueprint>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("chapter_blueprints_story_chapter_unq").on(
      table.storyId,
      table.chapterNumber,
    ),
    index("chapter_blueprints_story_idx").on(table.storyId),
  ],
);

export const continuitySnapshots = pgTable(
  "continuity_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storyId: uuid("story_id")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    /** The chapter this snapshot is the state AFTER (0 = initial, pre-Chapter 1). */
    afterChapterNumber: integer("after_chapter_number").notNull(),
    /** The immutable canonical continuity state (`ContinuityState`). */
    state: jsonb("state").$type<ContinuityState>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // One immutable snapshot per chapter number — the chain anchor. A second
    // concurrent publish of the same chapter collapses onto this row.
    unique("continuity_snapshots_story_chapter_unq").on(
      table.storyId,
      table.afterChapterNumber,
    ),
    index("continuity_snapshots_story_idx").on(table.storyId),
  ],
);

export const plotThreads = pgTable(
  "plot_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storyId: uuid("story_id")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    threadKey: varchar("thread_key", { length: 80 }).notNull(),
    description: text("description").notNull(),
    introduceInChapter: integer("introduce_in_chapter").notNull(),
    resolveInChapter: integer("resolve_in_chapter").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("plot_threads_story_key_unq").on(table.storyId, table.threadKey),
    index("plot_threads_story_idx").on(table.storyId),
  ],
);

export const plotThreadStates = pgTable(
  "plot_thread_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storyId: uuid("story_id")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    threadKey: varchar("thread_key", { length: 80 }).notNull(),
    /** The chapter after which this status held. */
    chapterNumber: integer("chapter_number").notNull(),
    status: plotThreadStatus("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // One status row per (thread, chapter) — idempotent chain anchor.
    unique("plot_thread_states_story_key_chapter_unq").on(
      table.storyId,
      table.threadKey,
      table.chapterNumber,
    ),
    index("plot_thread_states_story_idx").on(table.storyId),
  ],
);
