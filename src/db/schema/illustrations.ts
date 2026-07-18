import {
  type AnyPgColumn,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { IMAGE_CAPABILITIES } from "@/domain/model-capability";
import type { ImageSceneRequest } from "@/domain/image-request";
import type { VisionVerdict } from "@/domain/image-job";
import { families } from "./families";
import {
  chapterRevisions,
  chapters,
  illustrationSpecs,
  stories,
} from "./stories";

/**
 * CHAPTER ILLUSTRATION tables (`docs/03-ai/image-generation.md`,
 * `docs/05-backend/storage.md`, `docs/06-engineering/cost-management.md`). Image
 * BYTES live in private object storage — never here (AGENTS.md). These tables hold
 * records, keys, review verdicts, immutable revisions, the current publication
 * state, and per-call cost/usage lineage.
 *
 * TEXT-FIRST publication (rule stays true): the chapter text publishes with
 * placeholder slots (M7/M8); THESE rows fill the slots asynchronously and NEVER
 * block or discard approved text on image failure. Published illustrations are
 * IMMUTABLE revisions (rule 5); rejected/quarantined originals are unreachable by
 * reader delivery (rule 9), enforced by the `approved` + publication join.
 */

/** Lifecycle of a stored illustration asset (original or derivative). */
export const illustrationAssetState = pgEnum("illustration_asset_state", [
  "quarantined",
  "approved",
  "rejected",
  "retired",
]);

/** The resolved image state a reader sees for a spec (`image-job.ts`). */
export const illustrationState = pgEnum("illustration_state", [
  "pending",
  "approved",
  "manual-review",
  "failed",
]);

/** The closed image-capability vocabulary (`model-capability.ts`). */
export const imageCapability = pgEnum(
  "image_capability",
  IMAGE_CAPABILITIES as unknown as [string, ...string[]],
);

export const illustrationAssets = pgTable(
  "illustration_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    storyId: uuid("story_id")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    chapterId: uuid("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    /** The immutable chapter revision this illustration belongs to. */
    chapterRevisionId: uuid("chapter_revision_id")
      .notNull()
      .references(() => chapterRevisions.id, { onDelete: "cascade" }),
    specId: uuid("spec_id")
      .notNull()
      .references(() => illustrationSpecs.id, { onDelete: "cascade" }),
    /** "original" (the approved-source render) or "derivative" (responsive variant). */
    kind: text("kind").notNull(),
    /** Which repair phase produced the original ("initial"|"repair"|"escalation"). */
    phase: text("phase"),
    /** For a derivative: the source original. */
    originalAssetId: uuid("original_asset_id").references(
      (): AnyPgColumn => illustrationAssets.id,
      { onDelete: "cascade" },
    ),
    /** For a derivative: its target width in px. */
    variantWidth: integer("variant_width"),
    state: illustrationAssetState("state").notNull().default("quarantined"),
    /** Private object-store key — internal only, never exposed to clients. */
    storageKey: text("storage_key").notNull(),
    contentType: text("content_type").notNull(),
    checksum: text("checksum").notNull(),
    byteSize: integer("byte_size").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    model: text("model").notNull(),
    seed: integer("seed"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (table) => [
    unique("illustration_assets_key_unq").on(table.storageKey),
    index("illustration_assets_spec_state_idx").on(table.specId, table.state),
    index("illustration_assets_original_idx").on(table.originalAssetId),
    index("illustration_assets_family_idx").on(table.familyId),
  ],
);

export const illustrationRevisions = pgTable(
  "illustration_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    storyId: uuid("story_id")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    chapterId: uuid("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    chapterRevisionId: uuid("chapter_revision_id")
      .notNull()
      .references(() => chapterRevisions.id, { onDelete: "cascade" }),
    specId: uuid("spec_id")
      .notNull()
      .references(() => illustrationSpecs.id, { onDelete: "cascade" }),
    /** Monotonic per-spec revision number — immutable once minted (rule 5). */
    revisionNumber: integer("revision_number").notNull(),
    /** The approved original asset this revision publishes. */
    originalAssetId: uuid("original_asset_id")
      .notNull()
      .references(() => illustrationAssets.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    artBibleVersion: text("art_bible_version").notNull(),
    imageRouteVersion: text("image_route_version").notNull(),
    /** Lineage: the exact model-neutral request (prompt-builder inputs + refs). */
    requestSnapshot: jsonb("request_snapshot")
      .$type<ImageSceneRequest>()
      .notNull(),
    /** Lineage: the winning vision verdict. */
    verdictSnapshot: jsonb("verdict_snapshot").$type<VisionVerdict>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Immutable revision history: one row per (spec, revision number).
    unique("illustration_revisions_spec_revision_unq").on(
      table.specId,
      table.revisionNumber,
    ),
    index("illustration_revisions_spec_idx").on(table.specId),
  ],
);

export const illustrationReviews = pgTable(
  "illustration_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    specId: uuid("spec_id")
      .notNull()
      .references(() => illustrationSpecs.id, { onDelete: "cascade" }),
    workflowId: uuid("workflow_id"),
    phase: text("phase").notNull(),
    verdict: jsonb("verdict").$type<VisionVerdict>().notNull(),
    /** The app-policy decision this verdict produced ("approve"|"repair"|...). */
    decision: text("decision").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // One review per (spec, workflow, phase) — the idempotency anchor.
    unique("illustration_reviews_spec_workflow_phase_unq").on(
      table.specId,
      table.workflowId,
      table.phase,
    ),
    index("illustration_reviews_spec_idx").on(table.specId),
  ],
);

export const illustrationPublications = pgTable(
  "illustration_publications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    storyId: uuid("story_id")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    specId: uuid("spec_id")
      .notNull()
      .references(() => illustrationSpecs.id, { onDelete: "cascade" }),
    state: illustrationState("state").notNull().default("pending"),
    /** The published illustration revision when approved; null otherwise. */
    revisionId: uuid("revision_id").references(() => illustrationRevisions.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // One current publication per spec (approved image is a new revision, same row).
    unique("illustration_publications_spec_unq").on(table.specId),
    index("illustration_publications_story_idx").on(table.storyId),
  ],
);

export const imageGenerationRuns = pgTable(
  "image_generation_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyId: uuid("family_id").references(() => families.id, {
      onDelete: "cascade",
    }),
    storyId: uuid("story_id").references(() => stories.id, {
      onDelete: "cascade",
    }),
    specId: uuid("spec_id").references(() => illustrationSpecs.id, {
      onDelete: "cascade",
    }),
    workflowId: uuid("workflow_id"),
    stageKey: text("stage_key"),
    capability: imageCapability("capability").notNull(),
    phase: text("phase").notNull(),
    /** "generation" (an image call) or "review" (a vision call). */
    kind: text("kind").notNull(),
    /** The gateway slug targeted (may be a fallback/premium route). */
    target: text("target").notNull(),
    resolvedModelId: text("resolved_model_id").notNull(),
    routeVersion: text("route_version").notNull(),
    seed: integer("seed"),
    outcome: text("outcome").notNull(),
    failureKind: text("failure_kind"),
    /** How many images this call produced (1 for a single scene render). */
    imageCount: integer("image_count").notNull().default(0),
    estimatedCostMinorUnits: integer("estimated_cost_minor_units").notNull(),
    latencyMs: integer("latency_ms").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Idempotent re-record anchor: one row per (workflow, stage, phase, kind).
    unique("image_generation_runs_workflow_stage_phase_kind_unq").on(
      table.workflowId,
      table.stageKey,
      table.phase,
      table.kind,
    ),
    index("image_generation_runs_spec_idx").on(table.specId),
    index("image_generation_runs_capability_idx").on(table.capability),
  ],
);
