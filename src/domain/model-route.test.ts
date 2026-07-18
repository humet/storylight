import { describe, expect, it } from "vitest";

import {
  type ModelRouteVersion,
  resolveRolloutRoute,
  rolloutBucket,
} from "./model-route";

function route(over: Partial<ModelRouteVersion>): ModelRouteVersion {
  return {
    id: "baseline",
    capability: "one-off-planning",
    version: "1.0.0",
    primaryTarget: "anthropic/claude-sonnet-5",
    fallbacks: [],
    settings: { maxOutputTokens: 4000 },
    lifecycleStatus: "active",
    evaluationProfile: null,
    approvalRecord: null,
    isCanary: false,
    canaryRule: null,
    ...over,
  };
}

describe("rolloutBucket", () => {
  it("is deterministic and in [0,100)", () => {
    for (const k of ["a", "story-123", "series-xyz"]) {
      const b = rolloutBucket(k);
      expect(b).toBe(rolloutBucket(k));
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(100);
    }
  });
});

describe("resolveRolloutRoute (canary applies only to NEW stories)", () => {
  const baseline = route({ id: "baseline" });

  it("uses the baseline when there is no canary", () => {
    const { route: r, arm } = resolveRolloutRoute({
      storyKey: "any",
      baseline,
    });
    expect(r.id).toBe("baseline");
    expect(arm).toBe("baseline");
  });

  it("routes a share of new-story keys to the canary at its rollout percent", () => {
    const canary = route({
      id: "canary",
      isCanary: true,
      canaryRule: { rolloutPercent: 50 },
    });
    const keys = Array.from({ length: 200 }, (_v, i) => `story-${i}`);
    const arms = keys.map(
      (storyKey) => resolveRolloutRoute({ storyKey, baseline, canary }).arm,
    );
    const canaryCount = arms.filter((a) => a === "canary").length;
    // ~50% (loose bounds — this is a hash split, not exact).
    expect(canaryCount).toBeGreaterThan(60);
    expect(canaryCount).toBeLessThan(140);
  });

  it("a 0% canary never routes any new story to it", () => {
    const canary = route({
      id: "canary",
      isCanary: true,
      canaryRule: { rolloutPercent: 0 },
    });
    for (const storyKey of ["a", "b", "c", "d", "e"]) {
      expect(resolveRolloutRoute({ storyKey, baseline, canary }).arm).toBe(
        "baseline",
      );
    }
  });

  it("the SAME story key is stable across calls (a re-created key never flips arm)", () => {
    const canary = route({
      id: "canary",
      isCanary: true,
      canaryRule: { rolloutPercent: 50 },
    });
    const first = resolveRolloutRoute({
      storyKey: "series-42",
      baseline,
      canary,
    });
    const again = resolveRolloutRoute({
      storyKey: "series-42",
      baseline,
      canary,
    });
    expect(again.arm).toBe(first.arm);
    expect(again.route.id).toBe(first.route.id);
  });
});
