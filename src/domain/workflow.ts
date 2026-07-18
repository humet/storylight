import type { SafeErrorCode } from "@/lib/errors";

/**
 * Core workflow-execution domain types (`docs/03-ai/orchestration.md`,
 * ADR-002/006). Storylight OWNS its workflow state (ADR-002): the state machine,
 * stage outputs, idempotency, and retry accounting live in our Postgres tables
 * and the pure functions in this folder — the durable dispatcher is only
 * "durable compute that calls back into the engine".
 *
 * Pure types only: no IO, no Drizzle row shapes, no provider SDK. The Drizzle
 * layer maps rows to these; the engine and services depend on these.
 */

/**
 * The lifecycle statuses a workflow execution can hold. The set is documented
 * (`docs/03-ai/orchestration.md`); the ADJACENCY between them (which event moves
 * which status where) is defined — as a pure, exhaustively-tested function — in
 * `./workflow-transition.ts` (ADR-006 appendix delegates the matrix to M5).
 */
export type WorkflowStatus =
  "queued" | "running" | "waiting" | "completed" | "failed" | "cancelled";

export const WORKFLOW_STATUSES: readonly WorkflowStatus[] = [
  "queued",
  "running",
  "waiting",
  "completed",
  "failed",
  "cancelled",
];

/**
 * Terminal statuses. `completed` and `cancelled` are truly final; `failed` is a
 * DEAD-LETTER terminal — resumable via an explicit `resume` event
 * (`docs/05-backend/background-jobs.md` "Dead letter": preserve resumable
 * state). No stage runs while a workflow is terminal.
 */
export const TERMINAL_STATUSES: readonly WorkflowStatus[] = [
  "completed",
  "failed",
  "cancelled",
];

export function isTerminalStatus(status: WorkflowStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Events that drive a status change. Each is applied by the engine at a specific
 * point; the pure transition function decides the resulting status or rejects an
 * illegal move.
 *
 *  - `claim`    a dispatcher acquired the lease to run the next stage.
 *  - `yield`    a stage completed and more stages remain (park, resumable).
 *  - `retry`    a stage failed retryably; parked with a back-off schedule.
 *  - `complete` the final stage completed.
 *  - `fail`     retries exhausted or a non-retryable failure (dead-letter).
 *  - `cancel`   cancelled at a safe point.
 *  - `resume`   an operator/parent re-queues a dead-lettered workflow.
 */
export type WorkflowEvent =
  "claim" | "yield" | "retry" | "complete" | "fail" | "cancel" | "resume";

/**
 * The SAFE shape of a workflow failure, stored in `workflow_executions.last_error`
 * (jsonb) and safe to surface to a client. It is deliberately the client-safe
 * subset of a `DomainError` — never `internalDetail`, `cause`, or `stack`
 * (domain rule 12, `docs/05-backend/api.md`).
 */
export interface WorkflowError {
  code: SafeErrorCode;
  message: string;
  stage?: string;
  retryable: boolean;
  /** ISO-8601 timestamp of when the failure was recorded. */
  occurredAt: string;
}

/**
 * A workflow execution record (`docs/03-ai/orchestration.md` `WorkflowExecution`,
 * extended with the family/tenancy, idempotency, lease, and back-off fields the
 * engine needs). `input` carries IDs + command metadata only — never large prose
 * or image bytes (`docs/05-backend/background-jobs.md` "Job payloads").
 */
export interface WorkflowExecution {
  id: string;
  type: string;
  status: WorkflowStatus;
  requestId: string;
  familyId: string;
  userId: string;
  entityId?: string;
  /** The stage the workflow is currently at / next to run. */
  currentStage: string;
  /** Attempts made against the CURRENT stage (reset to 0 on advance). */
  attempt: number;
  /** Validated command metadata (IDs only). Shape is per-workflow-type. */
  input: unknown;
  lastError?: WorkflowError;
  /** Lease holder token while a dispatcher runs a stage (visibility timeout). */
  leaseOwner?: string;
  leaseExpiresAt?: Date;
  /** When the next retry attempt becomes eligible (back-off schedule). */
  nextAttemptAt?: Date;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  updatedAt: Date;
}

/**
 * The handle returned to a caller from `startWorkflow`. `created` is false when
 * a duplicate submission resolved to the existing execution (idempotency).
 */
export interface WorkflowHandle {
  workflowId: string;
  status: WorkflowStatus;
  created: boolean;
}
