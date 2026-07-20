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

export const IMAGE_ROUTE_VERSION = "mvp-image-routes-v1";

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
  // Routine 2K chapter illustration (cost-management.md: prefer routine over premium).
  "routine-chapter-illustration": {
    target: "google/gemini-3.1-flash-image",
    costMinorUnitsPerImage: 350,
  },
  // Premium escalation tier.
  "premium-chapter-illustration": {
    target: "google/gemini-3-pro-image",
    costMinorUnitsPerImage: 900,
  },
  // Targeted repair (kept on the routine tier).
  "illustration-repair": {
    target: "google/gemini-3.1-flash-image",
    costMinorUnitsPerImage: 350,
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
