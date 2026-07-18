import type { VisionVerdict } from "@/domain/image-job";
import type { ImageRouteResolution } from "@/domain/image-route";

/**
 * VISION MODEL port (`docs/03-ai/image-generation.md` "Vision review"). A
 * multimodal review of a generated scene against the scene's expectations,
 * returning the STRUCTURED {@link VisionVerdict} the app-code policy decides on
 * (identity per child, count, outfit/prop continuity, tone, style). The model
 * never writes canonical state and never approves anything — it only reports;
 * `decideImageReview` (pure) owns the decision. Adapters live in
 * `src/adapters/images/**` (rule 12).
 */

export interface VisionReviewRequest {
  imageBytes: Uint8Array;
  imageContentType: string;
  /** The children who must each be present with matching identity. */
  expectedChildren: { characterKey: string }[];
  /** Total characters expected in the frame (count check). */
  expectedCount: number;
  /** Continuity expectations the review checks (internal, model-neutral). */
  outfitNotes: string[];
  propNotes: string[];
  /** The intended emotional tone (age-appropriate). */
  tone: string;
  /** The pinned Art Bible version the style must be consistent with. */
  artBibleVersion: string;
}

export interface VisionReviewResult {
  verdict: VisionVerdict;
  /** Opaque model identifier for lineage (e.g. "fake-vision@1"). */
  model: string;
}

export interface VisionModel {
  review(
    request: VisionReviewRequest,
    route: ImageRouteResolution,
  ): Promise<VisionReviewResult>;
}
