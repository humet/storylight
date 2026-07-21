import type { ImageCapability } from "./model-capability";

/**
 * IMAGE ROUTE resolution (`docs/03-ai/models.md`, `docs/03-ai/image-generation.md`
 * "Story visual profile": every story pins an image route version). Pure type. The
 * source-controlled image-route registry (application layer) resolves an image
 * CAPABILITY to a concrete gateway target + a per-image flat cost, mirroring how
 * language capabilities resolve to a `ModelRouteVersion`. The resolved target,
 * version and model id are recorded per run for lineage + cost management.
 *
 * The registry is a source-controlled HISTORY of immutable versions (v1, v2, …);
 * a series pins the version active at its creation and its GENERATION tiers resolve
 * against that pinned version thereafter (rule 8 / ADR-009), so a later route swap
 * never changes an existing series' look. The VISION REVIEW route always resolves
 * the active version (ADR-009 scope). The pinned VISUAL PROFILE versions (which
 * reference set) are pinned separately and consumed by reference selection.
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
