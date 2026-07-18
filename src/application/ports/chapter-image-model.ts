import type { ImageSceneRequest } from "@/domain/image-request";
import type { ImageRouteResolution } from "@/domain/image-route";

/**
 * CHAPTER IMAGE MODEL port (`docs/03-ai/image-generation.md`, ADR-003/006).
 * Model-neutral: it takes the application-built {@link ImageSceneRequest} (never a
 * prompt string) + the resolved image route, and returns scene image bytes +
 * lineage. Adapters live in `src/adapters/images/**`; provider SDKs never leak past
 * this boundary (rule 12). Distinct from the M4 `ImageModel` (character reference
 * VIEWS) — chapter scenes take references + a repair instruction and arbitrary
 * aspect/resolution (the ImageModel/LanguageModel reconciliation, resolved in M9).
 */
export interface GeneratedSceneImage {
  bytes: Uint8Array;
  contentType: string;
  width: number;
  height: number;
  /** Opaque model identifier for lineage (e.g. "fake-scene@1"). */
  model: string;
  seed: number;
}

export interface ChapterImageModel {
  /** Render one scene from the model-neutral request via the resolved route. */
  generate(
    request: ImageSceneRequest,
    route: ImageRouteResolution,
  ): Promise<GeneratedSceneImage>;
}
