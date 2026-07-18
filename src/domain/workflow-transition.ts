import { DomainError } from "@/lib/errors";
import type { WorkflowEvent, WorkflowStatus } from "./workflow";

/**
 * The workflow state-transition matrix, as a pure, total function
 * (`docs/03-ai/orchestration.md` "State machine": invalid transitions throw
 * domain errors, and the rules belong in code and tests). ADR-006's appendix
 * delegates the adjacency to M5; this module IS that decision, and it is
 * exhaustively unit-tested.
 *
 * States (documented) → adjacency (chosen here):
 *
 *   queued    --claim-->   running
 *   queued    --cancel-->  cancelled
 *   running   --yield-->   waiting     (a stage finished, more remain)
 *   running   --retry-->   waiting     (stage failed retryably; parked w/ back-off)
 *   running   --complete-> completed
 *   running   --fail-->    failed      (exhausted / non-retryable: dead-letter)
 *   running   --cancel-->  cancelled
 *   waiting   --claim-->   running      (resume the next stage)
 *   waiting   --cancel-->  cancelled
 *   failed    --resume-->  queued       (re-queue a dead-lettered workflow)
 *   completed / cancelled  are final (no outgoing edges)
 *
 * `waiting` is the durable resting point between stages AND after a scheduled
 * retry — a cleanly stopped or crashed-then-leased-expired dispatcher leaves the
 * workflow here, and a fresh dispatcher resumes it by `claim`. `failed` is a
 * resumable dead-letter (`docs/05-backend/background-jobs.md`).
 */

const MATRIX: Record<
  WorkflowStatus,
  Partial<Record<WorkflowEvent, WorkflowStatus>>
> = {
  queued: { claim: "running", cancel: "cancelled" },
  running: {
    yield: "waiting",
    retry: "waiting",
    complete: "completed",
    fail: "failed",
    cancel: "cancelled",
  },
  waiting: { claim: "running", cancel: "cancelled" },
  completed: {},
  failed: { resume: "queued" },
  cancelled: {},
};

/**
 * The status reached by applying `event` to `from`. Throws a client-safe
 * `WORKFLOW_LOCKED` domain error for an illegal transition — an illegal move is
 * a bug, a race, or a stale command, never something to silently coerce.
 */
export function transitionWorkflowStatus(
  from: WorkflowStatus,
  event: WorkflowEvent,
): WorkflowStatus {
  const next = MATRIX[from][event];
  if (next === undefined) {
    throw new DomainError({
      code: "WORKFLOW_LOCKED",
      safeMessage:
        "This is already being worked on. Please try again in a moment.",
      internalDetail: `Illegal workflow transition "${event}" from status "${from}".`,
      stage: "workflow.transition",
    });
  }
  return next;
}

/** Whether `event` is legal from `from` (no throw). */
export function canTransition(
  from: WorkflowStatus,
  event: WorkflowEvent,
): boolean {
  return MATRIX[from][event] !== undefined;
}
