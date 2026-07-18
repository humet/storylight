import { describe, expect, it } from "vitest";

import { isDomainError } from "@/lib/errors";
import {
  assignSyntheticPlanIds,
  crossReferenceSyntheticPlan,
  normaliseSyntheticPlan,
  validateSyntheticPlan,
  type SyntheticPlanWireLike,
} from "./synthetic-plan";

function wire(
  overrides: Partial<SyntheticPlanWireLike> = {},
): SyntheticPlanWireLike {
  return {
    schemaVersion: "synthetic-plan.v1",
    title: "  The Lantern  ",
    summary: "A gentle tale.",
    characters: [{ key: "rosa", name: " Rosa " }],
    beats: [{ key: "beat-1", characterKey: "rosa", action: " finds it " }],
    ...overrides,
  };
}

describe("crossReferenceSyntheticPlan", () => {
  it("accepts a plan whose beats reference known characters", () => {
    expect(() => crossReferenceSyntheticPlan(wire())).not.toThrow();
  });

  it("rejects an unknown character reference", () => {
    expect(() =>
      crossReferenceSyntheticPlan(
        wire({ beats: [{ key: "b", characterKey: "ghost", action: "x" }] }),
      ),
    ).toThrowError();
  });

  it("rejects duplicate character keys", () => {
    try {
      crossReferenceSyntheticPlan(
        wire({
          characters: [
            { key: "rosa", name: "A" },
            { key: "rosa", name: "B" },
          ],
        }),
      );
      throw new Error("should have thrown");
    } catch (error) {
      expect(isDomainError(error)).toBe(true);
    }
  });

  it("rejects duplicate beat keys", () => {
    expect(() =>
      crossReferenceSyntheticPlan(
        wire({
          beats: [
            { key: "b", characterKey: "rosa", action: "x" },
            { key: "b", characterKey: "rosa", action: "y" },
          ],
        }),
      ),
    ).toThrowError();
  });
});

describe("normaliseSyntheticPlan", () => {
  it("trims strings and computes the derived beat count", () => {
    const plan = normaliseSyntheticPlan(wire());
    expect(plan.title).toBe("The Lantern");
    expect(plan.characters[0].name).toBe("Rosa");
    expect(plan.beats[0].action).toBe("finds it");
    expect(plan.beatCount).toBe(1);
  });
});

describe("validateSyntheticPlan", () => {
  it("passes a valid plan", () => {
    expect(() =>
      validateSyntheticPlan(normaliseSyntheticPlan(wire())),
    ).not.toThrow();
  });

  it("rejects a plan with no beats", () => {
    const plan = normaliseSyntheticPlan(wire({ beats: [] }));
    expect(() => validateSyntheticPlan(plan)).toThrowError();
  });
});

describe("assignSyntheticPlanIds", () => {
  it("maps semantic keys to deterministic app-generated ids", async () => {
    const plan = normaliseSyntheticPlan(wire());
    const correlation = { workflowId: "wf-1", stageKey: "plan" };
    const a = await assignSyntheticPlanIds(plan, correlation);
    const b = await assignSyntheticPlanIds(plan, correlation);

    // Deterministic across runs (idempotent persistence).
    expect(a).toEqual(b);
    // Ids are UUIDs, not the semantic keys, and beats resolve to character ids.
    expect(a.characters[0].id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(a.characters[0].id).not.toBe("rosa");
    expect(a.beats[0].characterId).toBe(a.characters[0].id);
    // Different correlation → different ids.
    const c = await assignSyntheticPlanIds(plan, {
      workflowId: "wf-2",
      stageKey: "plan",
    });
    expect(c.characters[0].id).not.toBe(a.characters[0].id);
  });
});
