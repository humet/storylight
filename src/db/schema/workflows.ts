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

import type { WorkflowError } from "@/domain/workflow";
import { families } from "./families";
import { users } from "./auth";

/**
 * Workflow-engine tables (`docs/03-ai/orchestration.md`,
 * `docs/05-backend/background-jobs.md`, `docs/05-backend/database.md`, ADR-002).
 * Storylight OWNS its workflow state here — the state machine, stage outputs,
 * idempotency, lease, and retry accounting all live in these rows; the durable
 * dispatcher only calls back into the engine.
 *
 *  - `workflow_executions`   — one row per workflow run: its type, status,
 *                              idempotency key, the domain entity it acts on, the
 *                              current stage, retry attempt, lease, and a SAFE
 *                              last-error. `input` is IDs + command metadata ONLY
 *                              — never prose or image bytes (AGENTS.md / job
 *                              payload rules).
 *  - `workflow_stage_outputs`— one row per (workflow, stage): the validated stage
 *                              output plus generation lineage. Its
 *                              `UNIQUE(workflow_id, stage_key)` is the idempotency
 *                              anchor — the engine checks it before invoking a
 *                              provider, so a resumed workflow never repeats work.
 */

/** Documented workflow statuses (`docs/03-ai/orchestration.md`). */
export const workflowStatus = pgEnum("workflow_status", [
  "queued",
  "running",
  "waiting",
  "completed",
  "failed",
  "cancelled",
]);

export const workflowExecutions = pgTable(
  "workflow_executions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    // `users.id` is a text column (Better Auth string IDs), so the FK is text.
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workflowType: text("workflow_type").notNull(),
    status: workflowStatus("status").notNull().default("queued"),
    /** Stable idempotency key from the command (`orchestration.md`). */
    requestId: text("request_id").notNull(),
    /** The domain entity this run acts on (e.g. a character id), if any. */
    entityId: uuid("entity_id"),
    /** The stage currently at / next to run. */
    currentStage: text("current_stage").notNull(),
    /** Attempts made against the current stage (reset to 0 on advance). */
    attempt: integer("attempt").notNull().default(0),
    /** Validated command metadata — IDs only, never large payloads. */
    input: jsonb("input").notNull(),
    /** SAFE error shape only (no internalDetail/cause/stack). */
    lastError: jsonb("last_error").$type<WorkflowError>(),
    /** Lease holder token + expiry (visibility timeout / concurrency guard). */
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    /** When the next retry attempt becomes eligible (back-off schedule). */
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Idempotency (`docs/03-ai/orchestration.md`, `docs/05-backend/database.md`):
    // a duplicate submission with the same request id resolves to one row.
    unique("workflow_executions_user_request_type_unq").on(
      table.userId,
      table.requestId,
      table.workflowType,
    ),
    index("workflow_executions_family_idx").on(table.familyId),
    // Correlation lookup: the latest run of a type acting on an entity.
    index("workflow_executions_entity_idx").on(
      table.familyId,
      table.workflowType,
      table.entityId,
    ),
  ],
);

export const workflowStageOutputs = pgTable(
  "workflow_stage_outputs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflowExecutions.id, { onDelete: "cascade" }),
    stageKey: text("stage_key").notNull(),
    output: jsonb("output").notNull(),
    /** Which attempt produced this output. */
    attempt: integer("attempt").notNull().default(0),
    // Generation lineage (`docs/03-ai/orchestration.md` "Stage persistence").
    // Nullable until the structured AI adapters land (M6).
    promptVersion: text("prompt_version"),
    schemaVersion: text("schema_version"),
    modelRouteVersion: text("model_route_version"),
    usage: jsonb("usage"),
    latencyMs: integer("latency_ms"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // The idempotency anchor: one persisted output per (workflow, stage).
    unique("workflow_stage_outputs_workflow_stage_unq").on(
      table.workflowId,
      table.stageKey,
    ),
    index("workflow_stage_outputs_workflow_idx").on(table.workflowId),
  ],
);
