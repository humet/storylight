import { describe, expect, it } from "vitest";

import {
  ACTIVE_IMAGE_ROUTE_VERSION,
  createImageRouteRegistry,
  IMAGE_ROUTE_V1_VERSION,
  IMAGE_ROUTE_V2_VERSION,
  IMAGE_ROUTE_VERSION,
  IMAGE_ROUTE_VERSIONS,
} from "./image-route-registry";
import { DomainError } from "@/lib/errors";

/**
 * Pins the image-route registry after ADR-009 (per-series image-route pinning). The
 * registry is now a source-controlled HISTORY of immutable versions; GENERATION
 * tiers resolve against a pinned version when given (a series' pin) else the active
 * version, while the VISION REVIEW route always floats with active. v2 (active)
 * moves routine + repair to Seedream; v1 stays all-Gemini as an immutable record.
 */
describe("image route registry (active = v2, Seedream routine tier)", () => {
  const registry = createImageRouteRegistry();

  it("routes the routine + repair generation phases to Seedream at 120 minor units", () => {
    const initial = registry.resolveGeneration("initial");
    const repair = registry.resolveGeneration("repair");
    for (const route of [initial, repair]) {
      expect(route.target).toBe("bytedance/seedream-5.0-pro");
      expect(route.costMinorUnitsPerImage).toBe(120);
      expect(route.version).toBe(ACTIVE_IMAGE_ROUTE_VERSION);
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

  it("carries the active route version so publications record v2 provenance", () => {
    expect(ACTIVE_IMAGE_ROUTE_VERSION).toBe("mvp-image-routes-v2");
    expect(IMAGE_ROUTE_VERSION).toBe(ACTIVE_IMAGE_ROUTE_VERSION);
    expect(registry.activeVersion()).toBe("mvp-image-routes-v2");
  });
});

describe("image route registry — per-series pinning (ADR-009, rule 8)", () => {
  // Inject a HYPOTHETICAL newer active version (v3) that changes the routine +
  // repair targets, while keeping v1 + v2 as immutable records. This is the
  // "route later swapped" situation an existing series must be insulated from.
  const HYPOTHETICAL_V3 = "mvp-image-routes-v3";
  const withV3Active = createImageRouteRegistry({
    activeVersion: HYPOTHETICAL_V3,
    versions: {
      ...IMAGE_ROUTE_VERSIONS,
      [HYPOTHETICAL_V3]: {
        routes: {
          "character-reference-generation": {
            target: "google/gemini-3-pro-image",
            costMinorUnitsPerImage: 400,
          },
          "style-reference-generation": {
            target: "google/gemini-3-pro-image",
            costMinorUnitsPerImage: 400,
          },
          "routine-chapter-illustration": {
            target: "acme/newmodel-v3",
            costMinorUnitsPerImage: 90,
          },
          "premium-chapter-illustration": {
            target: "acme/newmodel-v3-pro",
            costMinorUnitsPerImage: 700,
          },
          "illustration-repair": {
            target: "acme/newmodel-v3",
            costMinorUnitsPerImage: 90,
          },
        },
        review: { target: "google/gemini-4-flash", costMinorUnitsPerImage: 40 },
      },
    },
  });

  it("(a) a series pinned to v2 keeps v2 generation targets even when v3 is active", () => {
    // Same registry instance whose ACTIVE version is the new v3.
    const activeInitial = withV3Active.resolveGeneration("initial");
    expect(activeInitial.target).toBe("acme/newmodel-v3");
    expect(activeInitial.version).toBe(HYPOTHETICAL_V3);

    // A series pinned to v2 resolves the OLD (v2) targets — no drift.
    const pinnedInitial = withV3Active.resolveGeneration(
      "initial",
      IMAGE_ROUTE_V2_VERSION,
    );
    expect(pinnedInitial.target).toBe("bytedance/seedream-5.0-pro");
    expect(pinnedInitial.costMinorUnitsPerImage).toBe(120);
    expect(pinnedInitial.version).toBe(IMAGE_ROUTE_V2_VERSION);

    const pinnedRepair = withV3Active.resolveGeneration(
      "repair",
      IMAGE_ROUTE_V2_VERSION,
    );
    expect(pinnedRepair.target).toBe("bytedance/seedream-5.0-pro");

    const pinnedEscalation = withV3Active.resolveGeneration(
      "escalation",
      IMAGE_ROUTE_V2_VERSION,
    );
    expect(pinnedEscalation.target).toBe("google/gemini-3-pro-image");
    expect(pinnedEscalation.version).toBe(IMAGE_ROUTE_V2_VERSION);
  });

  it("a series pinned to v1 keeps the original all-Gemini routine target", () => {
    const pinned = withV3Active.resolveGeneration(
      "initial",
      IMAGE_ROUTE_V1_VERSION,
    );
    expect(pinned.target).toBe("google/gemini-3.1-flash-image");
    expect(pinned.costMinorUnitsPerImage).toBe(350);
    expect(pinned.version).toBe(IMAGE_ROUTE_V1_VERSION);
  });

  it("(b) a one-off (no pinned version) resolves the ACTIVE version", () => {
    const oneOff = withV3Active.resolveGeneration("initial");
    expect(oneOff.version).toBe(HYPOTHETICAL_V3);
    expect(oneOff.target).toBe("acme/newmodel-v3");
  });

  it("(c) an unknown pinned version throws a typed, non-retryable error (never a silent fallback)", () => {
    const registry = createImageRouteRegistry();
    let caught: unknown;
    try {
      registry.resolveGeneration("initial", "mvp-image-routes-does-not-exist");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DomainError);
    const domainError = caught as DomainError;
    expect(domainError.code).toBe("INVALID_COMMAND");
    expect(domainError.retryable).toBe(false);
  });

  it("(d) the vision review route ALWAYS resolves the active version, never a pin", () => {
    // On the v3-active registry the review floats to v3's reviewer + version.
    const review = withV3Active.resolveReview();
    expect(review.version).toBe(HYPOTHETICAL_V3);
    expect(review.target).toBe("google/gemini-4-flash");

    // On the real registry the review is the active (v2) reviewer.
    const real = createImageRouteRegistry().resolveReview();
    expect(real.version).toBe(ACTIVE_IMAGE_ROUTE_VERSION);
    expect(real.target).toBe("google/gemini-2.5-flash");
  });
});
