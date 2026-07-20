import {
  APICallError,
  createGateway,
  generateText,
  type ModelMessage,
} from "ai";

import type {
  GeneratedImage,
  ImageGenerationSpec,
  ImageModel,
} from "@/application/ports/image-model";
import { createImageRouteRegistry } from "@/application/model-routes/image-route-registry";
import { artBibleForVersion } from "@/domain/art-bible";
import type { ReferenceView } from "@/domain/reference-view";
import { REFERENCE_VIEW_LABELS } from "@/domain/reference-view";
import { generationFailedError, isDomainError } from "@/lib/errors";

/**
 * The REAL character-reference image adapter (M4 `ImageModel` port,
 * `docs/03-ai/image-generation.md` "Character identity", ADR-003/006). Allowed to
 * import the Vercel AI SDK (`ai`) — fenced to `src/adapters/**` (rule 12).
 *
 * It renders ONE canonical reference view per call from the model-neutral
 * {@link ImageGenerationSpec} (descriptor + view + pinned Art Bible + seed) via
 * the Gemini image model, reached through the AI Gateway's LANGUAGE API
 * (`generateText` + `gateway.languageModel(slug)`, reading the raster from
 * `result.files`) — the gateway rejects these models on `generateImage`.
 *
 * CROSS-VIEW CONSISTENCY: the M4 `ImageModel` port is per-view and stateless (the
 * visual-character service loops the six views, calling `generate` once each), so
 * conditioning every non-front view on a freshly generated front portrait would
 * mean re-generating the portrait inside each call — double the paid work. This
 * adapter therefore does the sanctioned minimum: text→image per view, sharing one
 * detailed descriptor + Art Bible directive block + a DETERMINISTIC seed so the
 * views stay stylistically coherent. Generating a whole set in one conditioned
 * pass would require widening the port (a documented follow-up); the parent still
 * approves the resulting set as a whole before it becomes canonical.
 *
 * Credential is passed EXPLICITLY to `createGateway` (ambient OIDC does not fire
 * in the WDK `"use step"` context). ADR-007: no decode/resize in the runtime —
 * canonical view dimensions are reported for lineage.
 */

/** Aspect-appropriate canvas per view (mirrors the fake's framing). */
const VIEW_SIZE: Record<ReferenceView, { width: number; height: number }> = {
  "front-portrait": { width: 768, height: 1024 },
  "three-quarter": { width: 768, height: 1024 },
  "full-body-front": { width: 768, height: 1152 },
  "side-view": { width: 768, height: 1152 },
  expression: { width: 1024, height: 768 },
  "default-outfit": { width: 768, height: 1024 },
};

/** How to frame each canonical view for a consistent character sheet. */
const VIEW_FRAMING: Record<ReferenceView, string> = {
  "front-portrait":
    "a head-and-shoulders FRONT portrait, facing the viewer, neutral warm expression, plain soft background",
  "three-quarter":
    "a head-and-shoulders THREE-QUARTER portrait turned ~45°, same face and hair, plain soft background",
  "full-body-front":
    "a FULL-BODY front view, standing, whole figure head to feet, plain soft background",
  "side-view":
    "a FULL side PROFILE view, standing, whole figure, plain soft background",
  expression:
    "a FRONT portrait showing a gentle, happy EXPRESSION, same face and hair, plain soft background",
  "default-outfit":
    "a FULL-BODY front view wearing their EVERYDAY OUTFIT, plain soft background",
};

function isAvailabilityError(error: unknown): boolean {
  if (APICallError.isInstance(error)) {
    if (error.isRetryable) return true;
    const status = error.statusCode;
    return status === 408 || status === 429 || (status ?? 0) >= 500;
  }
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return (
    message.includes("timeout") ||
    message.includes("network") ||
    message.includes("aborted")
  );
}

function buildInstruction(spec: ImageGenerationSpec): string {
  const artBible = artBibleForVersion(spec.artBibleVersion);
  const { descriptor } = spec;
  const lines: string[] = [
    `Paint a character reference: ${VIEW_FRAMING[spec.view]}.`,
    "",
    `CHARACTER: "${descriptor.displayName}", apparent age ${descriptor.apparentAge}, pronouns ${descriptor.pronouns.join("/")}.`,
  ];
  if (descriptor.motifs.length > 0) {
    lines.push(
      `Gentle visual motifs (subtle, uncluttered): ${descriptor.motifs.join(", ")}.`,
    );
  }
  lines.push(
    "",
    `STYLE: ${[artBible.medium, ...artBible.qualities].join("; ")}.`,
    `DO NOT: ${artBible.prohibitions.join("; ")}.`,
    "Keep the face and hair identical across views so this reference set is internally consistent. A single character only, centered, clear at phone size.",
  );
  return lines.join("\n");
}

export function createGatewayImageModel(): ImageModel {
  const apiKey =
    process.env.AI_GATEWAY_API_KEY ?? process.env.VERCEL_OIDC_TOKEN;
  const gateway = createGateway(apiKey ? { apiKey } : {});
  // Single-source the reference slug from the image-route registry.
  const target = createImageRouteRegistry().resolve(
    "character-reference-generation",
  ).target;

  return {
    async generate(spec: ImageGenerationSpec): Promise<GeneratedImage> {
      const { width, height } = VIEW_SIZE[spec.view];
      const messages: ModelMessage[] = [
        {
          role: "user",
          content: [{ type: "text", text: buildInstruction(spec) }],
        },
      ];
      try {
        const result = await generateText({
          model: gateway.languageModel(target),
          messages,
        });
        const image = result.files.find((file) =>
          file.mediaType?.startsWith("image/"),
        );
        if (!image) {
          throw generationFailedError({
            safeMessage: "We couldn't paint this option. Please try again.",
            internalDetail: `Gateway image model "${target}" returned no image file for view "${REFERENCE_VIEW_LABELS[spec.view]}" (finishReason=${result.finishReason}).`,
            retryable: false,
            stage: "adapter.gateway-image-model",
          });
        }
        return {
          view: spec.view,
          bytes: image.uint8Array,
          contentType: image.mediaType,
          width,
          height,
          model: result.response.modelId ?? target,
          seed: spec.seed,
        };
      } catch (error) {
        if (isDomainError(error)) throw error;
        const availability = isAvailabilityError(error);
        throw generationFailedError({
          safeMessage: availability
            ? "The illustration service is busy. Please try again."
            : "We couldn't paint this option. Please try again.",
          internalDetail:
            error instanceof Error ? error.message : String(error),
          retryable: availability,
          stage: "adapter.gateway-image-model",
          cause: error,
        });
      }
    },
  };
}
