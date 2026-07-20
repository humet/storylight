import "server-only";

import type { ImageModel } from "@/application/ports/image-model";
import type { ChapterImageModel } from "@/application/ports/chapter-image-model";
import type { VisionModel } from "@/application/ports/vision-model";
import { createFakeImageModel } from "./fake-image-model";
import { createFakeChapterImageModel } from "./fake-chapter-image-model";
import { createFakeVisionModel } from "./fake-vision-model";

/**
 * Image adapter selection (mirrors the DB/storage driver pattern). No
 * `AI_GATEWAY_API_KEY` here, so every port resolves to a deterministic FAKE:
 *  - {@link getImageModel}        — M4 character reference VIEWS (SVG placeholders);
 *  - {@link getChapterImageModel} — M9 chapter SCENES (real PNG via a tiny
 *    dependency-free encoder — ADR-007: no image codec in the runtime);
 *  - {@link getVisionModel}       — M9 multimodal review (scriptable structured verdicts).
 *
 * There is no derivative/encode adapter: per ADR-007 Storylight does not encode or
 * resize images in its serverless runtime — the approved ORIGINAL is stored and
 * delivered as-is.
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
