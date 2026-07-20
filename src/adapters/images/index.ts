import "server-only";

import type { ImageModel } from "@/application/ports/image-model";
import type { ChapterImageModel } from "@/application/ports/chapter-image-model";
import type { VisionModel } from "@/application/ports/vision-model";
import { getEnv } from "@/lib/env";
import { createFakeImageModel } from "./fake-image-model";
import { createFakeChapterImageModel } from "./fake-chapter-image-model";
import { createFakeVisionModel } from "./fake-vision-model";
import { createGatewayImageModel } from "./gateway-image-model";
import { createGatewayChapterImageModel } from "./gateway-chapter-image-model";
import { createGatewayVisionModel } from "./gateway-vision-model";

/**
 * Image adapter selection — mirrors `src/adapters/ai/index.ts` (the language
 * model) exactly:
 *  - `STORYLIGHT_FORCE_FIXTURE_MODELS` set → the deterministic FAKE (takes
 *    precedence, even when a key is present, so `pnpm test:e2e` is free + fast);
 *  - else `AI_GATEWAY_API_KEY` or a Vercel `VERCEL_OIDC_TOKEN` present → the REAL
 *    reference-capable gateway adapter;
 *  - otherwise (no credential) → the FAKE, which composes + runs fully offline
 *    (so dev, CI, and unbudgeted deploys never make paid calls and never throw at
 *    construction).
 *
 * The three ports:
 *  - {@link getImageModel}        — M4 character reference VIEWS;
 *  - {@link getChapterImageModel} — M9 chapter SCENES (reference-conditioned);
 *  - {@link getVisionModel}       — M9 multimodal identity/quality review.
 *
 * The REAL adapters reach the Gemini image/vision models through the AI Gateway's
 * LANGUAGE API (`generateText`), per the ADR-006 gateway decision; provider SDKs
 * stay inside `src/adapters/images/**` (rule 12). Per ADR-007 there is still NO
 * encode/derivative step — the approved ORIGINAL bytes are stored and delivered.
 */

/** True when a real gateway credential is available for paid image calls. */
function hasGatewayCredential(): boolean {
  const env = getEnv();
  if (env.STORYLIGHT_FORCE_FIXTURE_MODELS) return false;
  return Boolean(env.AI_GATEWAY_API_KEY || env.VERCEL_OIDC_TOKEN);
}

export function getImageModel(): ImageModel {
  return hasGatewayCredential()
    ? createGatewayImageModel()
    : createFakeImageModel();
}

export function getChapterImageModel(): ChapterImageModel {
  return hasGatewayCredential()
    ? createGatewayChapterImageModel()
    : createFakeChapterImageModel();
}

export function getVisionModel(): VisionModel {
  return hasGatewayCredential()
    ? createGatewayVisionModel()
    : createFakeVisionModel();
}
