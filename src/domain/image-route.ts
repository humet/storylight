import type { ImageCapability } from "./model-capability";

/**
 * IMAGE ROUTE resolution (`docs/03-ai/models.md`, `docs/03-ai/image-generation.md`
 * "Story visual profile": every story pins an image route version). Pure type. The
 * source-controlled image-route registry (application layer) resolves an image
 * CAPABILITY to a concrete gateway target + a per-image flat cost, mirroring how
 * language capabilities resolve to a `ModelRouteVersion`. The resolved target,
 * version and model id are recorded per run for lineage + cost management.
 *
 * MVP has ONE image-route version (`mvp-image-routes-v1`) with a routine and a
 * premium tier; per-series image-route PINNING beyond this single version is a
 * documented follow-up (recorded in BUILD_STATE) — the rule-8 obligation that
 * matters now is consuming the pinned VISUAL PROFILE versions for reference
 * selection, which M9 does.
 */
export interface ImageRouteResolution {
  capability: ImageCapability;
  /** The image-route registry version (pinned/recorded for lineage). */
  version: string;
  /** The gateway model slug this call targets (never `latest`). */
  target: string;
  /** Flat estimated cost per generated image, in minor units (cost-management.md). */
  costMinorUnitsPerImage: number;
}
