import {
  APICallError,
  createGateway,
  generateText,
  NoObjectGeneratedError,
  Output,
  type ModelMessage,
} from "ai";
import { z } from "zod";

import type {
  VisionModel,
  VisionReviewRequest,
  VisionReviewResult,
} from "@/application/ports/vision-model";
import type { ImageRouteResolution } from "@/domain/image-route";
import type { VisionVerdict } from "@/domain/image-job";
import type { ReferenceImage } from "@/domain/reference-image";
import { REFERENCE_VIEW_LABELS } from "@/domain/reference-view";
import { generationFailedError } from "@/lib/errors";

/**
 * The REAL vision-review adapter (`docs/03-ai/image-generation.md` "Vision
 * review", ADR-003/006). Allowed to import the Vercel AI SDK (`ai`) — fenced to
 * `src/adapters/**` by the ESLint boundary (rule 12).
 *
 * It runs a MULTIMODAL structured read: the child's approved reference bytes
 * PLUS the freshly generated scene are sent to a Gemini multimodal model via the
 * language API (`generateText` + `Output.object`), which REPORTS observations
 * against a strict verdict schema. The model never decides publication —
 * `decideImageReview` (pure) owns that; a wrong-identity / wrong-count verdict is
 * never approvable (rule 7). Identity is judged by COMPARING each expected child's
 * reference to the scene, which is why the workflow hands the reference bytes in.
 *
 * Unknown / missing per-child verdicts are mapped to `matches: false` (a safe
 * default — an unverified identity must not be approvable). `expectedCount` comes
 * from the application (the model only reports `observedCount`).
 *
 * The credential is passed EXPLICITLY to `createGateway` (ambient OIDC does not
 * fire in the WDK `"use step"` context). Errors are mapped like the language
 * adapter: availability failures throw retryable; a `NoObjectGeneratedError` or
 * any other failure is a non-retryable generation failure (raw detail server-side
 * only) — the review can never silently pass.
 */

const VerdictWireSchema = z.object({
  identityByChild: z.array(
    z.object({
      characterKey: z.string(),
      matches: z.boolean(),
    }),
  ),
  observedCount: z.number().int().min(0),
  outfitConsistent: z.boolean(),
  propConsistent: z.boolean(),
  toneAppropriate: z.boolean(),
  styleConsistent: z.boolean(),
  notes: z.string().optional(),
});

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

function buildInstruction(request: VisionReviewRequest): string {
  const expectedKeys = request.expectedChildren
    .map((c) => c.characterKey)
    .join(", ");
  const lines: string[] = [
    "You are a strict quality reviewer for a children's picture book. Compare the FINAL illustration (last image) against the attached identity reference image(s) and report ONLY what you observe. Do not approve or reject — just report.",
    "",
    `EXPECTED CHILDREN (one identity verdict per key): ${expectedKeys || "(none)"}.`,
    `EXPECTED TOTAL CHARACTERS IN FRAME: ${request.expectedCount}.`,
    "For identityByChild: for EACH expected key, set matches=true only if that child in the final illustration clearly has the SAME face and features as their reference; otherwise matches=false.",
    "For observedCount: count the distinct people actually visible in the final illustration.",
  ];
  if (request.outfitNotes.length > 0) {
    lines.push(
      `Expected outfit continuity: ${request.outfitNotes.join("; ")}.`,
    );
  }
  if (request.propNotes.length > 0) {
    lines.push(`Expected prop continuity: ${request.propNotes.join("; ")}.`);
  }
  lines.push(
    `Intended emotional tone (must be age-appropriate): ${request.tone}.`,
    `Style must match the pinned Art Bible (${request.artBibleVersion}): warm gouache storybook illustration, clear faces, no photorealism, no 3D, no text in the image.`,
    "Set outfitConsistent / propConsistent / toneAppropriate / styleConsistent accordingly.",
  );
  return lines.join("\n");
}

function buildMessages(
  request: VisionReviewRequest,
  referenceImages: ReferenceImage[],
): ModelMessage[] {
  const content: Array<
    | { type: "text"; text: string }
    | { type: "image"; image: Uint8Array; mediaType: string }
  > = [{ type: "text", text: buildInstruction(request) }];

  // Group references per expected child so the model sees who is who.
  for (const child of request.expectedChildren) {
    const refs = referenceImages.filter(
      (r) => r.characterKey === child.characterKey,
    );
    for (const ref of refs) {
      content.push({
        type: "text",
        text: `Identity reference for "${child.characterKey}" (${REFERENCE_VIEW_LABELS[ref.view]}):`,
      });
      content.push({
        type: "image",
        image: ref.bytes,
        mediaType: ref.contentType,
      });
    }
  }

  content.push({ type: "text", text: "FINAL illustration to review:" });
  content.push({
    type: "image",
    image: request.imageBytes,
    mediaType: request.imageContentType,
  });

  return [{ role: "user", content }];
}

export function createGatewayVisionModel(): VisionModel {
  const apiKey =
    process.env.AI_GATEWAY_API_KEY ?? process.env.VERCEL_OIDC_TOKEN;
  const gateway = createGateway(apiKey ? { apiKey } : {});

  return {
    async review(
      request: VisionReviewRequest,
      route: ImageRouteResolution,
      referenceImages: ReferenceImage[],
    ): Promise<VisionReviewResult> {
      try {
        const result = await generateText({
          model: gateway.languageModel(route.target),
          messages: buildMessages(request, referenceImages),
          output: Output.object({
            name: "vision_verdict",
            description:
              "Observations comparing the final children's-book illustration to the attached character reference images.",
            schema: VerdictWireSchema,
          }),
        });

        const wire = VerdictWireSchema.parse(result.output);
        const reported = new Map(
          wire.identityByChild.map((c) => [c.characterKey, c.matches]),
        );
        const verdict: VisionVerdict = {
          // One verdict per EXPECTED child; an unreported child is not a match
          // (rule 7: an unverified identity is never approvable).
          identityByChild: request.expectedChildren.map((c) => ({
            characterKey: c.characterKey,
            matches: reported.get(c.characterKey) ?? false,
          })),
          expectedCount: request.expectedCount,
          observedCount: wire.observedCount,
          outfitConsistent: wire.outfitConsistent,
          propConsistent: wire.propConsistent,
          toneAppropriate: wire.toneAppropriate,
          styleConsistent: wire.styleConsistent,
          ...(wire.notes ? { notes: wire.notes } : {}),
        };

        return {
          verdict,
          model: result.response.modelId ?? route.target,
        };
      } catch (error) {
        const availability = isAvailabilityError(error);
        const noObject = NoObjectGeneratedError.isInstance(error);
        throw generationFailedError({
          safeMessage: availability
            ? "The review service is busy. Please try again."
            : "This picture could not be reviewed. Please try again.",
          internalDetail:
            noObject && error instanceof NoObjectGeneratedError
              ? `Vision review produced no valid verdict: ${error.text ?? "(no text)"}`
              : error instanceof Error
                ? error.message
                : String(error),
          retryable: availability,
          stage: "adapter.gateway-vision-model",
          cause: error,
        });
      }
    },
  };
}
