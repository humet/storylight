import { describe, expect, it } from "vitest";

import { isDomainError } from "@/lib/errors";
import { canTransition, transitionWorkflowStatus } from "./workflow-transition";
import type { WorkflowEvent, WorkflowStatus } from "./workflow";
import { WORKFLOW_STATUSES } from "./workflow";

/**
 * Exhaustive proof of the M5 workflow state-transition matrix
 * (`docs/03-ai/orchestration.md` "State machine"; ADR-006 appendix delegates the
 * adjacency to M5). Every (status, event) pair is asserted — a legal move to its
 * target, an illegal move to a thrown `WORKFLOW_LOCKED` domain error — so the
 * matrix cannot silently change without a failing test.
 */

const EVENTS: WorkflowEvent[] = [
  "claim",
  "yield",
  "retry",
  "complete",
  "fail",
  "cancel",
  "resume",
];

// The single source of truth for the expected adjacency (mirrors the code, but
// written out independently so a mistake in either surfaces).
const EXPECTED: Record<
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

describe("transitionWorkflowStatus", () => {
  for (const from of WORKFLOW_STATUSES) {
    for (const event of EVENTS) {
      const expected = EXPECTED[from][event];
      if (expected) {
        it(`allows ${from} --${event}--> ${expected}`, () => {
          expect(transitionWorkflowStatus(from, event)).toBe(expected);
          expect(canTransition(from, event)).toBe(true);
        });
      } else {
        it(`rejects ${from} --${event}-->`, () => {
          expect(canTransition(from, event)).toBe(false);
          try {
            transitionWorkflowStatus(from, event);
            throw new Error("expected a thrown domain error");
          } catch (error) {
            expect(isDomainError(error)).toBe(true);
            if (isDomainError(error)) {
              expect(error.code).toBe("WORKFLOW_LOCKED");
              // The safe message never leaks the raw transition detail.
              expect(error.safeMessage).not.toContain(from);
            }
          }
        });
      }
    }
  }

  it("keeps completed and cancelled terminal (no outgoing edges)", () => {
    for (const event of EVENTS) {
      expect(canTransition("completed", event)).toBe(false);
      expect(canTransition("cancelled", event)).toBe(false);
    }
  });

  it("makes failed resumable via exactly one edge (resume → queued)", () => {
    const legal = EVENTS.filter((e) => canTransition("failed", e));
    expect(legal).toEqual(["resume"]);
    expect(transitionWorkflowStatus("failed", "resume")).toBe("queued");
  });
});
