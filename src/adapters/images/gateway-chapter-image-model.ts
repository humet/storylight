import {
  APICallError,
  createGateway,
  generateText,
  type ModelMessage,
} from "ai";

import type {
  ChapterImageModel,
  GeneratedSceneImage,
} from "@/application/ports/chapter-image-model";
import type { ImageRouteResolution } from "@/domain/image-route";
import {
  describeCastForPrompt,
  describeCompanionsForPrompt,
  describeSettingForPrompt,
  type ImageSceneRequest,
} from "@/domain/image-request";
import type { ReferenceImage } from "@/domain/reference-image";
import { REFERENCE_VIEW_LABELS } from "@/domain/reference-view";
import { generationFailedError, isDomainError } from "@/lib/errors";

/**
 * The REAL chapter-scene image adapter (`docs/03-ai/image-generation.md`
 * "Generation and review", ADR-003/006). One of the few modules allowed to import
 * the Vercel AI SDK (`ai`) — the ESLint boundary fences it to `src/adapters/**`
 * (rule 12).
 *
 * The Gemini image models are reached through the AI Gateway via the LANGUAGE API
 * (`generateText` + `gateway.languageModel(slug)`), NOT `generateImage`: the
 * gateway classifies them as language models and rejects `generateImage`. The
 * generated raster is read from `result.files` (each file exposes `.uint8Array` +
 * `.mediaType`).
 *
 * REFERENCE-DRIVEN IDENTITY (ADR-003, rule 7): the workflow resolves each
 * approved reference to its bytes and hands them in as `referenceImages`; this
 * adapter passes those bytes as image content parts so the model preserves each
 * child's approved identity rather than drifting from a prose description. Prompt
 * construction stays on THIS side of the boundary — the model-neutral
 * {@link ImageSceneRequest} never contains a prompt string.
 *
 * The credential is passed EXPLICITLY to `createGateway` (the SDK's ambient OIDC
 * auto-detection does not fire inside the WDK `"use step"` context — see the
 * language adapter). Errors are mapped like the language adapter: genuine
 * AVAILABILITY failures throw retryable so the workflow can react; everything else
 * is a non-retryable generation failure, with the raw provider message kept in
 * `internalDetail` only.
 *
 * ADR-007 (no image codec in the serverless runtime): this adapter does not decode
 * or resize. It reports the REQUESTED `request.dimensions` as the image's width/
 * height for lineage + the coarse technical gate — the model is asked to honour
 * the aspect, and the vision review governs correctness. No native/WASM codec is
 * ever loaded.
 */

/** True when a provider error is an AVAILABILITY failure worth a retry. */
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

const ASPECT_GUIDANCE: Record<ImageSceneRequest["aspect"], string> = {
  landscape: "4:3 landscape",
  portrait: "3:4 portrait",
  square: "1:1 square",
};

/** Build the concrete provider instruction from the model-neutral request. */
function buildInstruction(request: ImageSceneRequest): string {
  const lines: string[] = [
    "Paint a single premium children's-book illustration of the scene below.",
    "",
    `STYLE: ${request.styleDirectives.join("; ")}.`,
    `DO NOT: ${request.prohibitions.join("; ")}.`,
    `FRAMING: ${ASPECT_GUIDANCE[request.aspect]}, roughly ${request.dimensions.width}x${request.dimensions.height}px, faces and key objects clear at phone size.`,
    "",
    `SCENE: ${request.scene}`,
  ];

  // ADR-008 part 4: the canonical setting + time-of-day (so a night scene is not
  // rendered in daylight). Model-neutral directive lines; empty ⇒ nothing pushed.
  for (const directive of describeSettingForPrompt(request.setting)) {
    lines.push(directive);
  }

  if (request.placements.length > 0) {
    // Prefer the human display name (from the canonical cast) over the opaque
    // character key so the prompt names the child alongside its identity reference.
    const nameByKey = new Map(
      request.cast.children.map((c) => [c.characterKey, c.displayName]),
    );
    const inFrame = request.placements
      .map((p) => {
        const label = nameByKey.get(p.characterKey) ?? p.characterKey;
        return `${label}${p.prominent ? " (prominent)" : " (supporting)"}`;
      })
      .join(", ");
    lines.push(`CHARACTERS IN FRAME (exactly these): ${inFrame}.`);
  }

  // ADR-008 part 1: the explicit named child count + no-duplication directive —
  // the lever that removes the "two identical children" failure a reference image
  // alone does not prevent.
  const castDirectives = describeCastForPrompt(request.cast);
  for (const directive of castDirectives) {
    lines.push(directive);
  }

  // ADR-008 part 3: pin each recurring companion's species + appearance so a
  // companion is not redrawn as a different animal from the prose alone.
  for (const directive of describeCompanionsForPrompt(request.companions)) {
    lines.push(directive);
  }

  if (request.continuityNotes.length > 0) {
    lines.push(
      `CONTINUITY (must respect): ${request.continuityNotes.join("; ")}.`,
    );
  }

  lines.push(
    "",
    "The attached reference image(s) define each named child's canonical identity. Render every child with the SAME face, hair, skin tone and features as their reference — never invent or swap a child's likeness, and include only the characters listed above.",
  );

  if (request.repairInstruction) {
    lines.push(
      "",
      `TARGETED REPAIR (keep the existing composition, camera and palette; correct only this): ${request.repairInstruction}`,
    );
  }

  return lines.join("\n");
}

/** One user message: the instruction, then each labelled reference image. */
function buildMessages(
  request: ImageSceneRequest,
  referenceImages: ReferenceImage[],
): ModelMessage[] {
  const content: Array<
    | { type: "text"; text: string }
    | { type: "image"; image: Uint8Array; mediaType: string }
  > = [{ type: "text", text: buildInstruction(request) }];

  for (const ref of referenceImages) {
    const who = ref.characterKey ? ` for ${ref.characterKey}` : "";
    content.push({
      type: "text",
      text: `Identity reference${who} (${REFERENCE_VIEW_LABELS[ref.view]}):`,
    });
    content.push({
      type: "image",
      image: ref.bytes,
      mediaType: ref.contentType,
    });
  }

  return [{ role: "user", content }];
}

export function createGatewayChapterImageModel(): ChapterImageModel {
  const apiKey =
    process.env.AI_GATEWAY_API_KEY ?? process.env.VERCEL_OIDC_TOKEN;
  const gateway = createGateway(apiKey ? { apiKey } : {});

  return {
    async generate(
      request: ImageSceneRequest,
      route: ImageRouteResolution,
      referenceImages: ReferenceImage[],
    ): Promise<GeneratedSceneImage> {
      try {
        const result = await generateText({
          model: gateway.languageModel(route.target),
          messages: buildMessages(request, referenceImages),
        });

        const image = result.files.find((file) =>
          file.mediaType?.startsWith("image/"),
        );
        if (!image) {
          // The model returned no raster — a generation failure, not an
          // availability failure. The workflow records it and stops the ladder.
          throw generationFailedError({
            safeMessage: "This picture could not be painted. Please try again.",
            internalDetail: `Gateway image model "${route.target}" returned no image file (finishReason=${result.finishReason}).`,
            retryable: false,
            stage: "adapter.gateway-chapter-image-model",
          });
        }

        return {
          bytes: image.uint8Array,
          contentType: image.mediaType,
          // ADR-007: no decode. Report the requested dimensions for lineage +
          // the coarse aspect gate.
          width: request.dimensions.width,
          height: request.dimensions.height,
          model: result.response.modelId ?? route.target,
          seed: request.seed,
        };
      } catch (error) {
        // A no-image generation failure we already classified — re-throw as-is.
        if (isDomainError(error)) throw error;
        const availability = isAvailabilityError(error);
        throw generationFailedError({
          safeMessage: availability
            ? "The illustration service is busy. Please try again."
            : "This picture could not be painted. Please try again.",
          internalDetail:
            error instanceof Error ? error.message : String(error),
          retryable: availability,
          stage: "adapter.gateway-chapter-image-model",
          cause: error,
        });
      }
    },
  };
}
