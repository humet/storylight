import type {
  VisionModel,
  VisionReviewRequest,
  VisionReviewResult,
} from "@/application/ports/vision-model";
import type { VisionVerdict } from "@/domain/image-job";

/**
 * SCRIPTABLE FAKE vision model (M9). Structured verdicts, no network, no paid call.
 *
 *  - DEFAULT (dev / e2e): every review APPROVES — it reports each expected child
 *    present with matching identity, the exact expected count, and all continuity/
 *    tone/style gates green — so the offline pipeline reaches an approved image.
 *  - SCRIPTED (tests): supply a queue of verdicts; successive `review` calls pop
 *    the next one (then fall back to the approving default), which is how the
 *    identity-failure → repair → escalation → manual-pending path is exercised
 *    deterministically without any real model.
 */

export interface FakeVisionModelOptions {
  /** Verdicts returned in order by successive `review` calls. */
  verdicts?: VisionVerdict[];
}

const MODEL_ID = "fake-vision@1";

/** The default APPROVING verdict computed from the request. */
export function approvingVerdict(request: VisionReviewRequest): VisionVerdict {
  return {
    identityByChild: request.expectedChildren.map((c) => ({
      characterKey: c.characterKey,
      matches: true,
    })),
    expectedCount: request.expectedCount,
    observedCount: request.expectedCount,
    outfitConsistent: true,
    propConsistent: true,
    toneAppropriate: true,
    styleConsistent: true,
    // ADR-008: every expected companion present with the correct species, and the
    // setting consistent — so the offline pipeline reaches an approved image.
    companionsByKey: (request.expectedCompanions ?? []).map((c) => ({
      companionKey: c.key,
      matches: true,
    })),
    settingConsistent: true,
  };
}

export function createFakeVisionModel(
  options: FakeVisionModelOptions = {},
): VisionModel {
  const queue = [...(options.verdicts ?? [])];
  return {
    async review(request: VisionReviewRequest): Promise<VisionReviewResult> {
      const scripted = queue.shift();
      return {
        verdict: scripted ?? approvingVerdict(request),
        model: MODEL_ID,
      };
    },
  };
}
