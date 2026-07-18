import "server-only";

import type { ImageModel } from "@/application/ports/image-model";
import { createFakeImageModel } from "./fake-image-model";

/**
 * Image-model selection (mirrors the DB client's driver selection). In M4 there
 * is no `AI_GATEWAY_API_KEY` and the AI SDK infrastructure arrives in M6, so the
 * only adapter is the deterministic FAKE model — CI never makes a paid call
 * (ADR-006). The real reference-capable gateway adapter will be selected here in
 * M6/M9, behind the same {@link ImageModel} port.
 */
export function getImageModel(): ImageModel {
  return createFakeImageModel();
}
