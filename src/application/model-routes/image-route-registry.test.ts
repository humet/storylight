import { describe, expect, it } from "vitest";

import {
  createImageRouteRegistry,
  IMAGE_ROUTE_VERSION,
} from "./image-route-registry";

/**
 * Pins the image-route-v2 tier map after the Seedream swap: the ROUTINE + REPAIR
 * tiers move to `bytedance/seedream-5.0-pro` at ~⅓ cost, while premium escalation,
 * the M4 reference tiers and the vision review stay on Gemini.
 */
describe("image route registry (v2 — Seedream routine tier)", () => {
  const registry = createImageRouteRegistry();

  it("routes the routine + repair generation phases to Seedream at 120 minor units", () => {
    const initial = registry.resolveGeneration("initial");
    const repair = registry.resolveGeneration("repair");
    for (const route of [initial, repair]) {
      expect(route.target).toBe("bytedance/seedream-5.0-pro");
      expect(route.costMinorUnitsPerImage).toBe(120);
      expect(route.version).toBe(IMAGE_ROUTE_VERSION);
    }
  });

  it("keeps premium escalation on Gemini 3 Pro (unchanged)", () => {
    const escalation = registry.resolveGeneration("escalation");
    expect(escalation.target).toBe("google/gemini-3-pro-image");
    expect(escalation.costMinorUnitsPerImage).toBe(900);
  });

  it("keeps the M4 reference tiers on Gemini 3 Pro", () => {
    expect(registry.resolve("character-reference-generation").target).toBe(
      "google/gemini-3-pro-image",
    );
    expect(registry.resolve("style-reference-generation").target).toBe(
      "google/gemini-3-pro-image",
    );
  });

  it("keeps the vision review on Gemini 2.5 Flash", () => {
    expect(registry.resolveReview().target).toBe("google/gemini-2.5-flash");
  });

  it("carries the bumped route version so publications record v2 provenance", () => {
    expect(IMAGE_ROUTE_VERSION).toBe("mvp-image-routes-v2");
  });
});
