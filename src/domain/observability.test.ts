import { describe, expect, it } from "vitest";

import { buildEvent, NAMED_METRICS, STRUCTURED_EVENTS } from "./observability";

describe("buildEvent (safe-to-log)", () => {
  it("keeps ids, codes, and numeric measures", () => {
    const event = buildEvent({
      event: "workflow.created",
      correlation: { requestId: "r1", workflowId: "w1", familyId: "f1" },
      issue: "create-one-off-story",
      measures: { attempt: 0, latencyMs: 42 },
      at: "2026-07-18T00:00:00.000Z",
    });
    expect(event.event).toBe("workflow.created");
    expect(event.correlation.workflowId).toBe("w1");
    expect(event.measures).toEqual({ attempt: 0, latencyMs: 42 });
  });

  it("DROPS forbidden measure keys and non-finite numbers (never leaks content)", () => {
    const event = buildEvent({
      event: "stage.completed",
      correlation: { requestId: "r1" },
      // A careless caller tries to smuggle prose/bytes/a bad number in measures.
      measures: {
        prose: 1,
        bytes: 999,
        prompt: 5,
        latencyMs: 10,
        bad: Number.NaN,
      },
    });
    expect(event.measures).toEqual({ latencyMs: 10 });
  });

  it("omits an empty measures object", () => {
    const event = buildEvent({
      event: "chapter.published",
      correlation: { requestId: "r1", chapterId: "c1" },
      measures: { prose: 1 }, // all forbidden → dropped
    });
    expect(event.measures).toBeUndefined();
  });
});

describe("named contracts", () => {
  it("declares the observability.md structured events and metrics", () => {
    expect(STRUCTURED_EVENTS).toContain("continuity.rejected");
    expect(STRUCTURED_EVENTS).toContain("image.approved");
    expect(NAMED_METRICS).toContain("accepted-result-cost");
    expect(NAMED_METRICS).toContain("identity-failure-rate");
  });
});
