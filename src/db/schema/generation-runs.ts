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
} from "drizzle-orm/pg-core";

import { families } from "./families";
import { languageCapability, modelRouteVersions } from "./model-routes";
import { workflowExecutions } from "./workflows";

/**
 * GENERATION-RUN persistence (`docs/03-ai/structured-output.md`,
 * `docs/03-ai/orchestration.md` "Stage persistence",
 * `docs/06-engineering/cost-management.md`). Four tables:
 *
 *  - `prompt_versions` / `schema_versions` — immutable published-version records
 *    (one row per `(purpose, version)` / per `schemaVersion`). Historical
 *    artifacts remain parseable by their recorded version.
 *  - `generation_artifacts` — the VALIDATED, normalised artifact a run produced
 *    (domain data — NOT raw model output). One per `(workflow, stage)`.
 *  - `generation_runs` — one row per model CALL (attempt): capability, route
 *    version, RESOLVED model id, prompt/schema versions, token usage, latency,
 *    cost, outcome, attempt lineage, and correlation (workflow + stage). The full
 *    RAW output is never stored here (`structured-output.md` "Security"); a run
 *    may reference the validated artifact instead.
 */

/** Repair-ladder phase that produced an attempt (`generation-run.ts`). */
export const repairPhase = pgEnum("repair_phase", [
  "initial",
  "syntax-repair",
  "model-repair",
  "regenerate",
]);

/** Recorded outcome of an attempt (`generation-run.ts`). */
export const generationOutcome = pgEnum("generation_outcome", [
  "accepted",
  "repaired",
  "regenerated",
  "rejected",
  "failed",
]);

export const promptVersions = pgTable(
  "prompt_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    purpose: text("purpose").notNull(),
    version: text("version").notNull(),
    capability: languageCapability("capability").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("prompt_versions_purpose_version_unq").on(
      table.purpose,
      table.version,
    ),
  ],
);

export const schemaVersions = pgTable("schema_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** e.g. "synthetic-plan.v1" — the immutable published wire-schema version. */
  schemaVersion: text("schema_version").notNull().unique(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const generationArtifacts = pgTable(
  "generation_artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyId: uuid("family_id").references(() => families.id, {
      onDelete: "cascade",
    }),
    workflowId: uuid("workflow_id").references(() => workflowExecutions.id, {
      onDelete: "cascade",
    }),
    stageKey: text("stage_key"),
    schemaVersion: text("schema_version").notNull(),
    kind: text("kind").notNull(),
    /** The VALIDATED, normalised artifact (domain data). */
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // One artifact per (workflow, stage) — the idempotency anchor for re-records.
    unique("generation_artifacts_workflow_stage_unq").on(
      table.workflowId,
      table.stageKey,
    ),
    index("generation_artifacts_workflow_idx").on(table.workflowId),
  ],
);

export const generationRuns = pgTable(
  "generation_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyId: uuid("family_id").references(() => families.id, {
      onDelete: "cascade",
    }),
    workflowId: uuid("workflow_id").references(() => workflowExecutions.id, {
      onDelete: "cascade",
    }),
    stageKey: text("stage_key"),
    capability: languageCapability("capability").notNull(),
    modelRouteVersionId: uuid("model_route_version_id").references(
      () => modelRouteVersions.id,
      { onDelete: "set null" },
    ),
    routeVersion: text("route_version").notNull(),
    /** The provider model id the API actually resolved (`models.md`). */
    resolvedModelId: text("resolved_model_id").notNull(),
    /** The gateway slug this attempt targeted (may be a fallback). */
    target: text("target").notNull(),
    promptVersion: text("prompt_version").notNull(),
    schemaVersion: text("schema_version").notNull(),
    attemptIndex: integer("attempt_index").notNull(),
    parentAttemptIndex: integer("parent_attempt_index"),
    phase: repairPhase("phase").notNull(),
    outcome: generationOutcome("outcome").notNull(),
    /** Internal failure classification (never client-facing). Null on success. */
    failureKind: text("failure_kind"),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    totalTokens: integer("total_tokens").notNull(),
    estimatedCostMinorUnits: integer("estimated_cost_minor_units").notNull(),
    latencyMs: integer("latency_ms").notNull(),
    /** The validated artifact this run produced, if any. */
    artifactRef: uuid("artifact_ref").references(() => generationArtifacts.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Idempotent re-record anchor: one row per (workflow, stage, attempt).
    unique("generation_runs_workflow_stage_attempt_unq").on(
      table.workflowId,
      table.stageKey,
      table.attemptIndex,
    ),
    index("generation_runs_workflow_idx").on(table.workflowId),
    index("generation_runs_capability_idx").on(table.capability),
  ],
);
