import type { ImageCapability } from "@/domain/model-capability";
import type { ImageRouteResolution } from "@/domain/image-route";
import type { ImagePhase } from "@/domain/image-job";
import { invalidCommandError } from "@/lib/errors";

/**
 * Source-controlled IMAGE ROUTE registry (`docs/03-ai/models.md` route-by-
 * capability; `docs/03-ai/image-generation.md` "Story visual profile"; ADR-009).
 * Each version is a routine tier, a premium (escalation) tier, a repair tier, and a
 * vision-review target. Slugs are gateway model ids (never `latest`); the resolved
 * target + version + per-image flat cost are recorded per run for lineage + cost
 * management. Kept in-memory (no DB table) because image routes carry only
 * `local-fake` approvals and sit outside the M10 language-route lifecycle gate —
 * source-controlled exactly like the wire-schema / prompt versions, and pinned per
 * series the same way (ADR-009).
 *
 * MULTI-VERSION (RULE 8 — never mutate a published version in place; ADR-009): the
 * table is a history of immutable versions keyed by version id, exactly like the
 * illustration-plan wire schema keeps v1/v2/v3. `resolveGeneration(phase,
 * pinnedVersion?)` resolves the GENERATION tiers against the pinned version when
 * given (a series pins the version active at its creation), else the ACTIVE version.
 * An unknown pinned version is a LOUD typed error — never a silent fallback to
 * active. The VISION REVIEW route always resolves ACTIVE: a review is a safety
 * mechanism that should be upgradeable, and reviewing with a newer reader does not
 * change the series' visual identity (ADR-009 scope decision).
 */

interface ImageRouteSeed {
  target: string;
  costMinorUnitsPerImage: number;
}

/** One immutable image-route version: the per-capability generation tiers + the review target. */
interface ImageRouteVersionTable {
  routes: Record<ImageCapability, ImageRouteSeed>;
  review: ImageRouteSeed;
}

export const IMAGE_ROUTE_V1_VERSION = "mvp-image-routes-v1";
export const IMAGE_ROUTE_V2_VERSION = "mvp-image-routes-v2";

/**
 * v1 (M9) — the ORIGINAL all-Gemini table. Kept as an IMMUTABLE record (rule 8) so
 * a series pinned to v1 keeps rendering with gemini-3.1-flash-image on its routine
 * + repair tiers no matter what the active version later becomes. Values recovered
 * verbatim from git history of this file (commit 7b63cf7).
 */
const V1_TABLE: ImageRouteVersionTable = {
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
      target: "google/gemini-3.1-flash-image",
      costMinorUnitsPerImage: 350,
    },
    "premium-chapter-illustration": {
      target: "google/gemini-3-pro-image",
      costMinorUnitsPerImage: 900,
    },
    "illustration-repair": {
      target: "google/gemini-3.1-flash-image",
      costMinorUnitsPerImage: 350,
    },
  },
  review: { target: "google/gemini-2.5-flash", costMinorUnitsPerImage: 50 },
};

/**
 * v2 (2026-07-21, ADR-008 follow-up) — the ACTIVE version. The ROUTINE + REPAIR
 * tiers move from `google/gemini-3.1-flash-image` to `bytedance/seedream-5.0-pro`
 * — validated 2026-07-20/21 (BUILD_STATE) at identity/outfit/style parity on the
 * hard-scene set and the coherent-anchor path, at ~⅓ cost, watermark removed via
 * the adapter's bytedance `watermark:false` provider option. Premium escalation +
 * the M4 reference tiers stay on `google/gemini-3-pro-image`; the vision review
 * stays on `google/gemini-2.5-flash`.
 */
const V2_TABLE: ImageRouteVersionTable = {
  routes: {
    "character-reference-generation": {
      target: "google/gemini-3-pro-image",
      costMinorUnitsPerImage: 400,
    },
    "style-reference-generation": {
      target: "google/gemini-3-pro-image",
      costMinorUnitsPerImage: 400,
    },
    // COST: gemini-3.1-flash-image was 350 minor units at its ~$0.101/image @2K;
    // Seedream is a flat $0.035/image → 350 × (0.035 / 0.101) ≈ 121 → 120 (kept
    // proportional to the existing rows so the cost report stays comparable).
    "routine-chapter-illustration": {
      target: "bytedance/seedream-5.0-pro",
      costMinorUnitsPerImage: 120,
    },
    "premium-chapter-illustration": {
      target: "google/gemini-3-pro-image",
      costMinorUnitsPerImage: 900,
    },
    // Targeted repair (kept on the routine tier → also Seedream, same $0.035 → 120).
    "illustration-repair": {
      target: "bytedance/seedream-5.0-pro",
      costMinorUnitsPerImage: 120,
    },
  },
  review: { target: "google/gemini-2.5-flash", costMinorUnitsPerImage: 50 },
};

/** The source-controlled version history (immutable records, keyed by version id). */
export const IMAGE_ROUTE_VERSIONS: Readonly<
  Record<string, ImageRouteVersionTable>
> = {
  [IMAGE_ROUTE_V1_VERSION]: V1_TABLE,
  [IMAGE_ROUTE_V2_VERSION]: V2_TABLE,
};

/**
 * The currently ACTIVE image-route version. A route swap bumps this AND appends a
 * new immutable table above; existing series keep their pinned version (ADR-009).
 */
export const ACTIVE_IMAGE_ROUTE_VERSION = IMAGE_ROUTE_V2_VERSION;

/**
 * @deprecated Use {@link ACTIVE_IMAGE_ROUTE_VERSION}. Retained as an alias for
 * existing imports; equals the active version.
 */
export const IMAGE_ROUTE_VERSION = ACTIVE_IMAGE_ROUTE_VERSION;

export interface ImageRouteRegistry {
  /** Resolve a capability against the ACTIVE version (used by M4 reference generation). */
  resolve(capability: ImageCapability): ImageRouteResolution;
  /**
   * Resolve the GENERATION route for a repair-ladder phase (premium on escalation)
   * against `pinnedVersion` when given (a series' pinned version), else ACTIVE. An
   * unknown pinned version throws a LOUD typed error — never a silent fallback.
   */
  resolveGeneration(
    phase: ImagePhase,
    pinnedVersion?: string,
  ): ImageRouteResolution;
  /** Resolve the VISION REVIEW route. ALWAYS the active version (ADR-009 scope). */
  resolveReview(): ImageRouteResolution;
  /** The active image-route version id (what a new series pins at creation). */
  activeVersion(): string;
}

/** Optional overrides so tests can inject a hypothetical newer active version. */
export interface ImageRouteRegistryConfig {
  activeVersion?: string;
  versions?: Record<string, ImageRouteVersionTable>;
}

/** Which generation capability a repair-ladder phase paints with (pure). */
function generationCapabilityFor(phase: ImagePhase): ImageCapability {
  if (phase === "escalation") return "premium-chapter-illustration";
  if (phase === "repair") return "illustration-repair";
  return "routine-chapter-illustration";
}

export function createImageRouteRegistry(
  config: ImageRouteRegistryConfig = {},
): ImageRouteRegistry {
  const versions = config.versions ?? IMAGE_ROUTE_VERSIONS;
  const activeVersion = config.activeVersion ?? ACTIVE_IMAGE_ROUTE_VERSION;

  function tableFor(version: string): ImageRouteVersionTable {
    const table = versions[version];
    if (!table) {
      // LOUD, non-retryable, typed — a pinned version we no longer know how to
      // serve must fail visibly, never silently fall back to the active table
      // (that would defeat rule 8 / ADR-009).
      throw invalidCommandError({
        safeMessage:
          "This story's illustration settings are unavailable right now.",
        internalDetail: `Unknown image-route version "${version}".`,
        stage: "image.route",
      });
    }
    return table;
  }

  function resolveAt(
    capability: ImageCapability,
    version: string,
  ): ImageRouteResolution {
    const table = tableFor(version);
    const seed = table.routes[capability];
    if (!seed) {
      throw invalidCommandError({
        internalDetail: `No image route for capability "${capability}" in version "${version}".`,
        stage: "image.route",
      });
    }
    return {
      capability,
      version,
      target: seed.target,
      costMinorUnitsPerImage: seed.costMinorUnitsPerImage,
    };
  }

  return {
    resolve(capability) {
      return resolveAt(capability, activeVersion);
    },
    resolveGeneration(phase, pinnedVersion) {
      return resolveAt(
        generationCapabilityFor(phase),
        pinnedVersion ?? activeVersion,
      );
    },
    // The vision review is a multimodal TEXT read against a vision model — never
    // an image-generation slug — and ALWAYS runs the active version (ADR-009: a
    // newer reviewer does not change the series' look and review should be
    // upgradeable). It reports; the pure policy decides.
    resolveReview() {
      const table = tableFor(activeVersion);
      return {
        // No image-review entry exists in the closed ImageCapability vocabulary;
        // label it routine for the resolution shape — the recorded lineage is the
        // target + version below, and the workflow records the review run's own
        // capability separately.
        capability: "routine-chapter-illustration",
        version: activeVersion,
        target: table.review.target,
        costMinorUnitsPerImage: table.review.costMinorUnitsPerImage,
      };
    },
    activeVersion() {
      return activeVersion;
    },
  };
}
