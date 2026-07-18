import type { SuspenseLevel } from "./story-dna";

/**
 * THE FINAL-REVIEW POLICY (`docs/02-storytelling/safety-age-appropriateness.md`
 * "Review severity"; `docs/03-ai/structured-output.md` "Review models cannot
 * override deterministic policy"; `docs/03-ai/orchestration.md` "Revision
 * policy"). The review MODEL produces an advisory artifact; THIS pure function is
 * the authority that decides approve / revise / block / fail. A model can never
 * publish or override this decision (domain rule 3, `structured-output.md`).
 *
 * Decisions:
 *  - `block`   — a BLOCKING safety severity is present. Never publishable, at any
 *                revision count. Surfaces as SAFETY_REJECTION; nothing persists.
 *  - `revise`  — a non-safety quality/suitability problem AND the automatic
 *                revision budget (default two, `orchestration.md`) is not spent.
 *  - `fail`    — revise-worthy but the revision budget is exhausted. The workflow
 *                stays resumable and offers the parent a safe retry
 *                (GENERATION_FAILED) — it does NOT publish weakened content.
 *  - `approve` — no blocking and no revise-worthy problems.
 *
 * Pure + deterministic, exhaustively tested. Parents may only make it STRICTER
 * (`safety-age-appropriateness.md` "Parent override"): they can never turn a
 * blocking finding into a publishable one.
 */

export type ReviewSeverity = "blocking" | "major" | "minor";

/**
 * Closed vocabulary of review finding codes. The BLOCKING group mirrors the
 * "Blocking" severities in `safety-age-appropriateness.md`; MAJOR mirrors "Major";
 * the remaining quality codes come from the one-off reviewer checklist
 * (`one-off-stories.md` "Review").
 */
export const REVIEW_FINDING_CODES = [
  // Blocking (safety)
  "unsafe_content",
  "sexualised_minor",
  "graphic_injury",
  "discriminatory_content",
  "adult_themes",
  "self_harm_or_abuse",
  "unsafe_instruction",
  "severe_distress_unresolved",
  // Major (suitability)
  "excessive_suspense",
  "inappropriate_vocabulary",
  "frightening_close",
  "moralising_shame",
  // Quality (one-off checklist)
  "incomplete_arc",
  "weak_resolution",
  "sequel_dependency",
  "repetition",
  "weak_characterisation",
  "unsupported_real_world_claim",
  "excluded_topic_present",
  "peril_not_permitted",
  "grief_not_permitted",
] as const;

export type ReviewFindingCode = (typeof REVIEW_FINDING_CODES)[number];

/**
 * Codes that are ALWAYS blocking regardless of the severity the model attached —
 * a core child-safety rule cannot be downgraded by an advisory model
 * (`safety-age-appropriateness.md`: parents cannot disable core rules, and neither
 * can a model).
 */
const ALWAYS_BLOCKING: ReadonlySet<ReviewFindingCode> = new Set([
  "unsafe_content",
  "sexualised_minor",
  "graphic_injury",
  "discriminatory_content",
  "adult_themes",
  "self_harm_or_abuse",
  "unsafe_instruction",
  "severe_distress_unresolved",
]);

export interface ReviewFinding {
  code: ReviewFindingCode;
  severity: ReviewSeverity;
  /** Short evidence note (advisory; never shown raw to a child). */
  note: string;
}

/**
 * The advisory review artifact (the validated model output). Booleans capture the
 * one-off checklist; findings carry graded issues.
 */
export interface ReviewArtifact {
  completeArc: boolean;
  resolvesCentralProblem: boolean;
  endsCalmly: boolean;
  /** True is BAD: the story leans on a sequel to feel complete. */
  sequelDependency: boolean;
  ageAppropriate: boolean;
  findings: ReviewFinding[];
  summary: string;
}

/** The family safety configuration that can make the policy stricter. */
export interface ReviewPolicyConfig {
  maxSuspense: SuspenseLevel;
  allowMildPeril: boolean;
  allowDeathGrief: boolean;
}

export type ReviewDecisionKind = "approve" | "revise" | "block" | "fail";

export interface ReviewDecision {
  kind: ReviewDecisionKind;
  /** Internal reasons (for lineage/observability — never shown raw to a child). */
  reasons: string[];
}

/** Default automatic text revisions (`orchestration.md` "Revision policy"). */
export const MAX_AUTOMATIC_REVISIONS = 2;

const SUSPENSE_RANK: Record<SuspenseLevel, number> = {
  calm: 0,
  mild: 1,
  adventurous: 2,
};

export interface DecideReviewInput {
  review: ReviewArtifact;
  config: ReviewPolicyConfig;
  /** Revisions already applied (0 on the first review). */
  revisionsUsed: number;
  maxRevisions?: number;
}

/**
 * Decide the final outcome. Order matters: any blocking safety finding wins over
 * everything else and can never be revised away to publication.
 */
export function decideReviewOutcome(input: DecideReviewInput): ReviewDecision {
  const { review, config } = input;
  const maxRevisions = input.maxRevisions ?? MAX_AUTOMATIC_REVISIONS;

  // 1) BLOCKING safety — terminal, never publishable.
  const blocking: string[] = [];
  for (const f of review.findings) {
    if (f.severity === "blocking" || ALWAYS_BLOCKING.has(f.code)) {
      blocking.push(`${f.code}: ${f.note}`);
    }
  }
  if (blocking.length > 0) {
    return { kind: "block", reasons: blocking };
  }

  // 2) Revise-worthy non-safety problems (quality + suitability + parent strictness).
  const revise: string[] = [];
  if (!review.completeArc) revise.push("incomplete narrative arc");
  if (!review.resolvesCentralProblem)
    revise.push("central problem is unresolved");
  if (!review.endsCalmly) revise.push("does not end calmly");
  if (review.sequelDependency)
    revise.push("depends on a sequel to feel complete");
  if (!review.ageAppropriate) revise.push("not age appropriate");

  for (const f of review.findings) {
    if (f.severity === "major") {
      revise.push(`${f.code}: ${f.note}`);
      continue;
    }
    // Parent strictness escalates otherwise-minor findings.
    if (f.code === "excluded_topic_present") {
      revise.push(`${f.code}: ${f.note}`);
    } else if (f.code === "peril_not_permitted" && !config.allowMildPeril) {
      revise.push(`${f.code}: ${f.note}`);
    } else if (f.code === "grief_not_permitted" && !config.allowDeathGrief) {
      revise.push(`${f.code}: ${f.note}`);
    } else if (
      (f.code === "excessive_suspense" || f.code === "frightening_close") &&
      SUSPENSE_RANK[config.maxSuspense] === 0
    ) {
      // A calm-only family treats any suspense note as revise-worthy.
      revise.push(`${f.code}: ${f.note}`);
    }
  }

  if (revise.length === 0) {
    return { kind: "approve", reasons: [] };
  }

  // 3) Revise while budget remains; otherwise fail safely (resumable, safe retry).
  if (input.revisionsUsed < maxRevisions) {
    return { kind: "revise", reasons: revise };
  }
  return { kind: "fail", reasons: revise };
}
