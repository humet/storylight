import {
  APICallError,
  createGateway,
  generateText,
  type ModelMessage,
} from "ai";

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
import { parseVisionVerdict } from "./vision-verdict-parse";

/** How many times to ask for a parseable verdict before failing safe. */
const MAX_REVIEW_ATTEMPTS = 3;

/**
 * The REAL vision-review adapter (`docs/03-ai/image-generation.md` "Vision
 * review", ADR-003/006). Allowed to import the Vercel AI SDK (`ai`) — fenced to
 * `src/adapters/**` by the ESLint boundary (rule 12).
 *
 * It runs a MULTIMODAL read: the child's approved reference bytes PLUS the
 * freshly generated scene are sent to a Gemini multimodal model via the language
 * API (`generateText`), which REPORTS observations as a compact JSON verdict (see
 * ROBUST STRUCTURED OUTPUT below). The model never decides publication —
 * `decideImageReview` (pure) owns that; a wrong-identity / wrong-count verdict is
 * never approvable (rule 7). Identity is judged by COMPARING each expected child's
 * reference to the scene, which is why the workflow hands the reference bytes in.
 *
 * Unknown / missing per-child verdicts are mapped to `matches: false` (a safe
 * default — an unverified identity must not be approvable). `expectedCount` comes
 * from the application (the model only reports `observedCount`).
 *
 * The credential is passed EXPLICITLY to `createGateway` (ambient OIDC does not
 * fire in the WDK `"use step"` context).
 *
 * ROBUST STRUCTURED OUTPUT: it does NOT use the SDK's strict `Output.object` —
 * that path returns `NoObjectGeneratedError` too often on the multimodal review
 * model and silently rejects good illustrations. Instead it asks for compact
 * JSON in plain text and parses it leniently (`parseVisionVerdict`), retrying up
 * to {@link MAX_REVIEW_ATTEMPTS} times. Only if EVERY attempt fails to yield a
 * parseable verdict does it throw (fail safe — a verdict is never fabricated and
 * the review can never silently pass). Availability failures throw retryable so
 * the workflow can fall back.
 */

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
    `EXPECTED CHILDREN IN FRAME: ${request.expectedCount}.`,
    "For identityByChild: for EACH expected key, set matches=true only if that child in the final illustration clearly has the SAME face and features as their reference; otherwise matches=false.",
    "For observedCount: count only the distinct CHILDREN (people who appear to be children) visible in the final illustration. Do NOT count adults, companions, or animals — they are reviewed separately.",
  ];
  if (request.outfitNotes.length > 0) {
    lines.push(
      `Expected outfit continuity: ${request.outfitNotes.join("; ")}.`,
    );
  }
  if (request.propNotes.length > 0) {
    lines.push(`Expected prop continuity: ${request.propNotes.join("; ")}.`);
  }

  // ADR-008 part 3: recurring non-child companions the scene must depict with the
  // correct species. Companions have no reference image — they are described here.
  const companions = request.expectedCompanions ?? [];
  const companionKeys = companions.map((c) => c.key).join(", ");
  if (companions.length > 0) {
    lines.push(
      `EXPECTED COMPANIONS (recurring non-child characters), one companionsByKey verdict per key: ${companionKeys}.`,
    );
    for (const c of companions) {
      lines.push(`  - "${c.key}" is a ${c.species} (${c.appearance}).`);
    }
    lines.push(
      "For companionsByKey: for EACH expected companion, set matches=true ONLY if a character of that exact species clearly appears; if it is a different animal/creature or is absent, matches=false.",
    );
  }

  // ADR-008 part 4: the canonical setting + time-of-day.
  if (request.setting) {
    lines.push(
      `EXPECTED SETTING: ${request.setting.location} — time of day: ${request.setting.timeOfDay}.`,
      "For settingConsistent: set true ONLY if the location and the time-of-day lighting (sky, light) match the expected setting; a night scene rendered in daylight (or vice-versa) is settingConsistent=false.",
    );
  }

  lines.push(
    `Intended emotional tone (must be age-appropriate): ${request.tone}.`,
    `Style must match the pinned Art Bible (${request.artBibleVersion}): warm gouache storybook illustration, clear faces, no photorealism, no 3D, no text in the image.`,
    "Set outfitConsistent / propConsistent / toneAppropriate / styleConsistent accordingly.",
    "",
    "Reply with ONLY a compact JSON object (no markdown, no prose) of exactly this shape:",
    jsonShape(companions.length > 0, Boolean(request.setting)),
    `Include one identityByChild entry for each expected key (${expectedKeys || "none"}).`,
  );
  if (companions.length > 0) {
    lines.push(
      `Include one companionsByKey entry for each expected companion key (${companionKeys}).`,
    );
  }
  return lines.join("\n");
}

/** The exact JSON shape to request, including the ADR-008 fields only when relevant. */
function jsonShape(withCompanions: boolean, withSetting: boolean): string {
  const parts = [
    `"identityByChild":[{"characterKey":"<key>","matches":true|false}]`,
    `"observedCount":<int>`,
    `"outfitConsistent":true|false`,
    `"propConsistent":true|false`,
    `"toneAppropriate":true|false`,
    `"styleConsistent":true|false`,
  ];
  if (withCompanions) {
    parts.push(
      `"companionsByKey":[{"companionKey":"<key>","matches":true|false}]`,
    );
  }
  if (withSetting) parts.push(`"settingConsistent":true|false`);
  parts.push(`"notes":"<short>"`);
  return `{${parts.join(",")}}`;
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
      const messages = buildMessages(request, referenceImages);
      let lastText = "";
      for (let attempt = 0; attempt < MAX_REVIEW_ATTEMPTS; attempt++) {
        let text: string;
        try {
          const result = await generateText({
            model: gateway.languageModel(route.target),
            messages,
          });
          text = result.text;
          lastText = text;
          const wire = parseVisionVerdict(text);
          if (!wire) continue; // unparseable — ask again
          const reported = new Map(
            wire.identityByChild.map((c) => [c.characterKey, c.matches]),
          );
          const reportedCompanions = new Map(
            (wire.companionsByKey ?? []).map((c) => [
              c.companionKey,
              c.matches,
            ]),
          );
          const expectedCompanions = request.expectedCompanions ?? [];
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
            // One verdict per EXPECTED companion; an unreported companion is not a
            // match (ADR-008: a wrong/absent companion species is blocking, so it
            // must never be fabricated as a pass). Empty ⇒ no companion check.
            companionsByKey: expectedCompanions.map((c) => ({
              companionKey: c.key,
              matches: reportedCompanions.get(c.key) ?? false,
            })),
            // Trust the setting verdict only when a setting was expected; otherwise
            // skip (consistent). Absent-when-expected ⇒ skip (non-blocking, safe).
            settingConsistent: request.setting
              ? (wire.settingConsistent ?? true)
              : true,
            ...(wire.notes ? { notes: wire.notes } : {}),
          };
          return { verdict, model: result.response.modelId ?? route.target };
        } catch (error) {
          // Availability failures throw retryable immediately so the workflow
          // can fall back; other call errors are retried within this loop.
          if (isAvailabilityError(error)) {
            throw generationFailedError({
              safeMessage: "The review service is busy. Please try again.",
              internalDetail:
                error instanceof Error ? error.message : String(error),
              retryable: true,
              stage: "adapter.gateway-vision-model",
              cause: error,
            });
          }
          lastText = error instanceof Error ? error.message : String(error);
        }
      }

      // Every attempt failed to yield a parseable verdict. Fail safe — never
      // fabricate a verdict, never silently pass the review.
      throw generationFailedError({
        safeMessage: "This picture could not be reviewed. Please try again.",
        internalDetail: `Vision review produced no parseable verdict after ${MAX_REVIEW_ATTEMPTS} attempts. Last response: ${lastText.slice(0, 300)}`,
        retryable: false,
        stage: "adapter.gateway-vision-model",
      });
    },
  };
}
