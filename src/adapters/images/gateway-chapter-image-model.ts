import {
  APICallError,
  createGateway,
  generateImage,
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
  describeWardrobeForPrompt,
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
 * TWO GATEWAY API PATHS behind ONE port, branched by the route target's provider
 * (pure {@link imageApiForTarget}):
 *  - GEMINI image models (`google/…`) are reached through the LANGUAGE API
 *    (`generateText` + `gateway.languageModel(slug)`), NOT `generateImage`: the
 *    gateway classifies them as language models and rejects `generateImage`. The
 *    raster is read from `result.files` (each file exposes `.uint8Array` +
 *    `.mediaType`).
 *  - SEEDREAM (`bytedance/…`, the routine + repair tiers as of image-route v2) is
 *    the OPPOSITE — it must go through the dedicated IMAGE API (`generateImage`
 *    with `prompt: { images, text }`, references in `images`) and rejects the
 *    language API. Every bytedance call sets `providerOptions.bytedance.watermark
 *    = false` ({@link bytedanceProviderOptions}) — a watermarked image is a product
 *    defect for a premium publishing surface. Confirmed removable on the
 *    reference-conditioned path (BUILD_STATE 2026-07-21).
 *
 * The SAME deterministic {@link buildInstruction} text reaches BOTH paths; only the
 * transport (message content parts vs. `prompt.images` + `text`) differs.
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

/** The gateway aspect-ratio string per scene aspect (dedicated IMAGE API only). */
const ASPECT_RATIO: Record<ImageSceneRequest["aspect"], `${number}:${number}`> =
  {
    landscape: "4:3",
    portrait: "3:4",
    square: "1:1",
  };

/**
 * Gateway providers whose models are served ONLY by the dedicated IMAGE API
 * (`generateImage`) and rejected on the language API — the inverse of the Gemini
 * image models. Currently just bytedance (Seedream). Pure so branch SELECTION is
 * unit-tested without a paid call.
 */
const IMAGE_API_PROVIDERS: readonly string[] = ["bytedance"];

/** Which gateway API a route target must use. Pure. */
export function imageApiForTarget(target: string): "image" | "language" {
  const provider = target.split("/")[0]?.toLowerCase() ?? "";
  return IMAGE_API_PROVIDERS.includes(provider) ? "image" : "language";
}

/** Scene aspect → gateway `aspectRatio` string (dedicated IMAGE API). Pure. */
export function aspectRatioFor(
  aspect: ImageSceneRequest["aspect"],
): `${number}:${number}` {
  return ASPECT_RATIO[aspect];
}

/**
 * Provider options applied to EVERY bytedance/Seedream call. `watermark: false`
 * is non-negotiable — a visible "AI generated" stamp is a product defect on a
 * premium children's-book page (rule: premium publishing experience). Pure so a
 * test can assert it is always set.
 */
export function bytedanceProviderOptions() {
  return { bytedance: { watermark: false } } as const;
}

/**
 * The dedicated IMAGE-API prompt: the SAME deterministic instruction text as the
 * language path ({@link buildInstruction}) plus the reference bytes as the `images`
 * array (Seedream conditions identity on them). When there are NO references it
 * degrades to a plain text-to-image string prompt (a valid {@link GenerateImagePrompt}).
 * Pure — the message/prompt assembly is unit-tested. Bytes are handed straight
 * through; they never enter canonical state or a workflow payload.
 */
export function buildSeedreamPrompt(
  request: ImageSceneRequest,
  referenceImages: ReferenceImage[],
): { images: Uint8Array[]; text: string } | string {
  const text = buildInstruction(request);
  return referenceImages.length > 0
    ? { images: referenceImages.map((ref) => ref.bytes), text }
    : text;
}

/** Build the concrete provider instruction from the model-neutral request. */
export function buildInstruction(request: ImageSceneRequest): string {
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

  // ADR-008 part 2: for a non-everyday wardrobe, pin the declared outfit (no outfit
  // reference is attached for such a scene) and reiterate that face/hair/features
  // still follow the identity reference. Empty for an everyday/absent wardrobe (the
  // everyday outfit reference is attached and speaks for itself — byte-identical).
  for (const directive of describeWardrobeForPrompt(request.wardrobe)) {
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

  // GEMINI image models: the LANGUAGE API, raster read from `result.files`.
  async function generateViaLanguageApi(
    request: ImageSceneRequest,
    route: ImageRouteResolution,
    referenceImages: ReferenceImage[],
  ): Promise<GeneratedSceneImage> {
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
  }

  // SEEDREAM (bytedance): the dedicated IMAGE API. references go in `prompt.images`,
  // watermark stripped on every call.
  async function generateViaImageApi(
    request: ImageSceneRequest,
    route: ImageRouteResolution,
    referenceImages: ReferenceImage[],
  ): Promise<GeneratedSceneImage> {
    const result = await generateImage({
      model: gateway.imageModel(route.target),
      prompt: buildSeedreamPrompt(request, referenceImages),
      aspectRatio: aspectRatioFor(request.aspect),
      seed: request.seed,
      // watermark:false — a watermarked image is a product defect (rule).
      providerOptions: bytedanceProviderOptions(),
    });

    const image = result.image;
    if (!image || !image.mediaType?.startsWith("image/")) {
      throw generationFailedError({
        safeMessage: "This picture could not be painted. Please try again.",
        internalDetail: `Gateway image model "${route.target}" returned no image via generateImage.`,
        retryable: false,
        stage: "adapter.gateway-chapter-image-model",
      });
    }

    return {
      bytes: image.uint8Array,
      contentType: image.mediaType,
      // ADR-007: no decode. Report the requested dimensions for lineage.
      width: request.dimensions.width,
      height: request.dimensions.height,
      model: result.responses[0]?.modelId ?? route.target,
      seed: request.seed,
    };
  }

  return {
    async generate(
      request: ImageSceneRequest,
      route: ImageRouteResolution,
      referenceImages: ReferenceImage[],
    ): Promise<GeneratedSceneImage> {
      try {
        // Branch by the route target's provider — the two APIs are mutually
        // exclusive per model family (see the module doc).
        return imageApiForTarget(route.target) === "image"
          ? await generateViaImageApi(request, route, referenceImages)
          : await generateViaLanguageApi(request, route, referenceImages);
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
