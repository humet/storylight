import "server-only";

import type { ImageModel } from "@/application/ports/image-model";
import type { ChapterImageModel } from "@/application/ports/chapter-image-model";
import type { ImageDerivatives } from "@/application/ports/image-derivatives";
import type { VisionModel } from "@/application/ports/vision-model";
import { createFakeImageModel } from "./fake-image-model";
import { createFakeChapterImageModel } from "./fake-chapter-image-model";
import { createFakeVisionModel } from "./fake-vision-model";
import { createSharpDerivatives } from "./sharp-derivatives";

/**
 * Image adapter selection (mirrors the DB/storage driver pattern). No
 * `AI_GATEWAY_API_KEY` here, so every port resolves to a deterministic FAKE:
 *  - {@link getImageModel}        — M4 character reference VIEWS (SVG placeholders);
 *  - {@link getChapterImageModel} — M9 chapter SCENES (real PNG via sharp);
 *  - {@link getVisionModel}       — M9 multimodal review (scriptable structured verdicts);
 *  - {@link getImageDerivatives}  — M9 responsive AVIF/WebP variants (sharp).
 *
 * The real reference-capable gateway image + vision adapters land behind these
 * same ports (contract-typed) when `AI_GATEWAY_API_KEY` is present (ADR-006).
 */

export function getImageModel(): ImageModel {
  return createFakeImageModel();
}

export function getChapterImageModel(): ChapterImageModel {
  return createFakeChapterImageModel();
}

export function getVisionModel(): VisionModel {
  return createFakeVisionModel();
}

export function getImageDerivatives(): ImageDerivatives {
  return createSharpDerivatives();
}
