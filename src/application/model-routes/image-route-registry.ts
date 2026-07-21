import type { ImageCapability } from "@/domain/model-capability";
import type { ImageRouteResolution } from "@/domain/image-route";
import type { ImagePhase } from "@/domain/image-job";
import { invalidCommandError } from "@/lib/errors";

/**
 * Source-controlled IMAGE ROUTE registry (`docs/03-ai/models.md` route-by-
 * capability; `docs/03-ai/image-generation.md` "Story visual profile"). The MVP
 * has ONE image-route version with a routine tier, a premium (escalation) tier, and
 * a repair tier. Slugs are gateway model ids (never `latest`); the resolved
 * target + version + per-image flat cost are recorded per run for lineage + cost
 * management. Kept in-memory (no DB table) because MVP has a single version and no
 * lifecycle/evaluation gate yet — parallel to the language routes' DB table but
 * intentionally lighter (recorded in BUILD_STATE).
 */

// v2 (2026-07-21, ADR-008 follow-up): the ROUTINE tiers move from
// `google/gemini-3.1-flash-image` to `bytedance/seedream-5.0-pro` — validated
// 2026-07-20/21 (BUILD_STATE) at identity/outfit/style parity on the hard-scene
// set and the coherent-anchor path, at ~⅓ cost, watermark removed via the adapter's
// bytedance `watermark:false` provider option. Premium escalation + the M4
// reference tiers stay on `google/gemini-3-pro-image`; the vision review stays on
// `google/gemini-2.5-flash`. Bumping the version records the swap on every new
// publication's `image_route_version` provenance (rule 8 — see BUILD_STATE).
export const IMAGE_ROUTE_VERSION = "mvp-image-routes-v2";

interface ImageRouteSeed {
  target: string;
  costMinorUnitsPerImage: number;
}

/**
 * The VISION REVIEW route. Unlike generation, a review is a MULTIMODAL TEXT read
 * (compare references to the scene → structured verdict), so it must target a
 * language/vision model — NOT an image-generation slug. `google/gemini-2.5-flash`
 * is the confirmed-working multimodal reviewer (`docs/03-ai/models.md`: a
 * different family reviews). Kept as its own seed (there is no image-review entry
 * in the closed `ImageCapability` vocabulary, which is fixed by a Postgres enum);
 * the meaningful lineage fields recorded per run are the resolved target + route
 * version, both of which this carries correctly.
 */
const REVIEW_ROUTE: ImageRouteSeed = {
  target: "google/gemini-2.5-flash",
  costMinorUnitsPerImage: 50,
};

const ROUTES: Record<ImageCapability, ImageRouteSeed> = {
  // Character/style reference generation is M4's flow; listed for completeness.
  "character-reference-generation": {
    target: "google/gemini-3-pro-image",
    costMinorUnitsPerImage: 400,
  },
  "style-reference-generation": {
    target: "google/gemini-3-pro-image",
    costMinorUnitsPerImage: 400,
  },
  // Routine 2K chapter illustration (cost-management.md: prefer routine over
  // premium). Seedream 5.0 Pro reached the gateway via the dedicated IMAGE API
  // (see `gateway-chapter-image-model.ts`), watermark stripped per call.
  // COST: gemini-3.1-flash-image was 350 minor units at its ~$0.101/image @2K;
  // Seedream is a flat $0.035/image → 350 × (0.035 / 0.101) ≈ 121 → 120 (kept
  // proportional to the existing rows so the cost report stays comparable).
  "routine-chapter-illustration": {
    target: "bytedance/seedream-5.0-pro",
    costMinorUnitsPerImage: 120,
  },
  // Premium escalation tier — stays on Gemini 3 Pro (unchanged).
  "premium-chapter-illustration": {
    target: "google/gemini-3-pro-image",
    costMinorUnitsPerImage: 900,
  },
  // Targeted repair (kept on the routine tier → also Seedream, same $0.035 → 120).
  "illustration-repair": {
    target: "bytedance/seedream-5.0-pro",
    costMinorUnitsPerImage: 120,
  },
};

export interface ImageRouteRegistry {
  resolve(capability: ImageCapability): ImageRouteResolution;
  /** Resolve the GENERATION route for a repair-ladder phase (premium on escalation). */
  resolveGeneration(phase: ImagePhase): ImageRouteResolution;
  /** Resolve the VISION REVIEW route (a routine multimodal call). */
  resolveReview(): ImageRouteResolution;
}

export function createImageRouteRegistry(): ImageRouteRegistry {
  function resolve(capability: ImageCapability): ImageRouteResolution {
    const seed = ROUTES[capability];
    if (!seed) {
      throw invalidCommandError({
        internalDetail: `No image route for capability "${capability}".`,
        stage: "image.route",
      });
    }
    return {
      capability,
      version: IMAGE_ROUTE_VERSION,
      target: seed.target,
      costMinorUnitsPerImage: seed.costMinorUnitsPerImage,
    };
  }

  return {
    resolve,
    resolveGeneration(phase) {
      if (phase === "escalation")
        return resolve("premium-chapter-illustration");
      if (phase === "repair") return resolve("illustration-repair");
      return resolve("routine-chapter-illustration");
    },
    // The vision review is a multimodal TEXT read against a vision model — never
    // an image-generation slug. It reports; the pure policy decides.
    resolveReview() {
      return {
        // No image-review entry exists in the closed ImageCapability vocabulary;
        // label it routine for the resolution shape — the recorded lineage is the
        // target + version below, and the workflow records the review run's own
        // capability separately.
        capability: "routine-chapter-illustration",
        version: IMAGE_ROUTE_VERSION,
        target: REVIEW_ROUTE.target,
        costMinorUnitsPerImage: REVIEW_ROUTE.costMinorUnitsPerImage,
      };
    },
  };
}
