/**
 * IMAGE JOB state machine + review POLICY (`docs/03-ai/image-generation.md`
 * "Generation and review", "Targeted repair"). Pure and exhaustively tested.
 *
 * The repair budget is EXACTLY (docs default):
 *   initial attempt → one targeted repair → one premium escalation → then manual
 *   review / pending.
 *
 * The NON-NEGOTIABLE rule (AGENTS.md rule 7, `image-generation.md` "Acceptance
 * criteria"): WRONG CHILD IDENTITY or WRONG CHARACTER COUNT is a BLOCKING image
 * failure — the review policy can NEVER approve such an image, at any phase. This
 * is enforced structurally: `approve` requires an `acceptable` verdict, and a
 * verdict with any identity mismatch or count mismatch is never `acceptable`.
 */

/** The generation phase within the bounded repair ladder. */
export type ImagePhase = "initial" | "repair" | "escalation";

export const IMAGE_PHASES: readonly ImagePhase[] = [
  "initial",
  "repair",
  "escalation",
] as const;

/** The terminal image state a spec's illustration publication records. */
export type IllustrationState =
  "pending" | "approved" | "manual-review" | "failed";

/** Per-child identity verdict from the vision review. */
export interface ChildIdentityVerdict {
  characterKey: string;
  /** True when the rendered child matches this child's approved identity. */
  matches: boolean;
}

/**
 * The STRUCTURED vision-review verdict (`image-generation.md` "Vision review":
 * identity per child, count, outfit/prop continuity, tone, style). Produced by the
 * multimodal review port; never authored by the generation model.
 */
export interface VisionVerdict {
  /** One entry per expected child in the scene. */
  identityByChild: ChildIdentityVerdict[];
  expectedCount: number;
  observedCount: number;
  outfitConsistent: boolean;
  propConsistent: boolean;
  toneAppropriate: boolean;
  styleConsistent: boolean;
  /** Optional free-text notes (internal; never client-facing). */
  notes?: string;
}

export interface VerdictClassification {
  /** Every quality gate passed — the ONLY state from which approval is allowed. */
  acceptable: boolean;
  /** A blocking failure present (wrong identity or wrong count) — never approvable. */
  blocking: boolean;
  /** Human-readable reasons (internal), driving the repair instruction. */
  reasons: string[];
}

/**
 * Classify a verdict. `blocking` is true iff any child identity mismatches OR the
 * observed count differs from the expected count. `acceptable` requires NO
 * blocking failure AND all continuity/tone/style gates green.
 */
export function classifyVerdict(verdict: VisionVerdict): VerdictClassification {
  const reasons: string[] = [];

  const identityMismatch = verdict.identityByChild.filter((c) => !c.matches);
  for (const child of identityMismatch) {
    reasons.push(`wrong identity for child "${child.characterKey}"`);
  }
  const countMismatch = verdict.observedCount !== verdict.expectedCount;
  if (countMismatch) {
    reasons.push(
      `wrong character count (expected ${verdict.expectedCount}, observed ${verdict.observedCount})`,
    );
  }
  const blocking = identityMismatch.length > 0 || countMismatch;

  if (!verdict.outfitConsistent) reasons.push("outfit continuity broken");
  if (!verdict.propConsistent) reasons.push("plot-critical prop wrong");
  if (!verdict.toneAppropriate) reasons.push("emotional tone off");
  if (!verdict.styleConsistent) reasons.push("style inconsistent");

  const acceptable = !blocking && reasons.length === 0;
  return { acceptable, blocking, reasons };
}

export type ImageReviewDecisionKind =
  "approve" | "repair" | "escalate" | "manual";

export interface ImageReviewDecision {
  kind: ImageReviewDecisionKind;
  /** Internal reasons (drive the repair instruction; never client-facing). */
  reasons: string[];
}

/**
 * Decide what to do after a vision review at a given phase. Pure.
 *
 *  - `acceptable`  → approve.
 *  - otherwise the bounded ladder advances by phase:
 *      initial   → repair   (targeted repair attempt)
 *      repair    → escalate (premium escalation attempt)
 *      escalation→ manual   (manual review / pending — nothing publishable)
 *
 * A BLOCKING verdict (wrong identity / count) can NEVER yield `approve` — it is
 * not `acceptable`, so it always advances the ladder and, once exhausted, lands in
 * `manual`. It is never returned to a reader (rule 9): the original stays
 * quarantined and the publication records `manual-review`.
 */
export function decideImageReview(input: {
  verdict: VisionVerdict;
  phase: ImagePhase;
}): ImageReviewDecision {
  const { acceptable, reasons } = classifyVerdict(input.verdict);
  if (acceptable) return { kind: "approve", reasons: [] };

  switch (input.phase) {
    case "initial":
      return { kind: "repair", reasons };
    case "repair":
      return { kind: "escalate", reasons };
    case "escalation":
      return { kind: "manual", reasons };
  }
}

/** The next generation phase for a repair/escalation decision, or null at the end. */
export function nextPhase(phase: ImagePhase): ImagePhase | null {
  const index = IMAGE_PHASES.indexOf(phase);
  return index >= 0 && index < IMAGE_PHASES.length - 1
    ? IMAGE_PHASES[index + 1]
    : null;
}

/** Whether this phase should use the PREMIUM image route (the escalation rung). */
export function isPremiumPhase(phase: ImagePhase): boolean {
  return phase === "escalation";
}

/** Compose a targeted repair instruction from the failing reasons (composition-preserving). */
export function repairInstructionFor(reasons: string[]): string {
  return [
    "Keep the existing composition, camera and palette.",
    "Correct only these specific problems while preserving everything else:",
    ...reasons.map((r) => `- ${r}`),
  ].join(" ");
}
