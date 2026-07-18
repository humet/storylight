import { describe, expect, it } from "vitest";

import {
  decideReviewOutcome,
  MAX_AUTOMATIC_REVISIONS,
  REVIEW_FINDING_CODES,
  type ReviewArtifact,
  type ReviewFinding,
  type ReviewFindingCode,
  type ReviewPolicyConfig,
} from "./review-policy";

/**
 * Exhaustive tests for the FINAL-REVIEW POLICY — the pure app-code authority over
 * publish/revise/block/fail (`docs/02-storytelling/safety-age-appropriateness.md`,
 * `docs/03-ai/structured-output.md`: review models cannot override policy). The
 * central guarantees: a blocking severity NEVER publishes at any revision count,
 * and the revise path is bounded at two automatic revisions.
 */

const CLEAN: ReviewArtifact = {
  completeArc: true,
  resolvesCentralProblem: true,
  endsCalmly: true,
  sequelDependency: false,
  ageAppropriate: true,
  findings: [],
  summary: "A gentle, complete bedtime story.",
};

const DEFAULT_CONFIG: ReviewPolicyConfig = {
  maxSuspense: "mild",
  allowMildPeril: true,
  allowDeathGrief: false,
};

function withFindings(...findings: ReviewFinding[]): ReviewArtifact {
  return { ...CLEAN, findings };
}

const BLOCKING_CODES: ReviewFindingCode[] = [
  "unsafe_content",
  "sexualised_minor",
  "graphic_injury",
  "discriminatory_content",
  "adult_themes",
  "self_harm_or_abuse",
  "unsafe_instruction",
  "severe_distress_unresolved",
];

describe("decideReviewOutcome — approval", () => {
  it("approves a clean review", () => {
    const decision = decideReviewOutcome({
      review: CLEAN,
      config: DEFAULT_CONFIG,
      revisionsUsed: 0,
    });
    expect(decision.kind).toBe("approve");
  });

  it("approves when a minor finding is not escalated by config", () => {
    const decision = decideReviewOutcome({
      review: withFindings({
        code: "repetition",
        severity: "minor",
        note: "slight repetition",
      }),
      config: DEFAULT_CONFIG,
      revisionsUsed: 0,
    });
    expect(decision.kind).toBe("approve");
  });
});

describe("decideReviewOutcome — blocking is terminal", () => {
  it.each(BLOCKING_CODES)(
    "blocks on the always-blocking code %s even when marked minor",
    (code) => {
      const decision = decideReviewOutcome({
        review: withFindings({ code, severity: "minor", note: "downgraded" }),
        config: DEFAULT_CONFIG,
        revisionsUsed: 0,
      });
      expect(decision.kind).toBe("block");
    },
  );

  it("blocks on any finding marked blocking, regardless of code", () => {
    const decision = decideReviewOutcome({
      review: withFindings({
        code: "repetition",
        severity: "blocking",
        note: "escalated by the model",
      }),
      config: DEFAULT_CONFIG,
      revisionsUsed: 0,
    });
    expect(decision.kind).toBe("block");
  });

  it("blocks even after the revision budget is spent (never revised away)", () => {
    for (let used = 0; used <= MAX_AUTOMATIC_REVISIONS + 1; used++) {
      const decision = decideReviewOutcome({
        review: withFindings({
          code: "graphic_injury",
          severity: "blocking",
          note: "unsafe",
        }),
        config: DEFAULT_CONFIG,
        revisionsUsed: used,
      });
      expect(decision.kind).toBe("block");
    }
  });

  it("blocking wins when both blocking and major findings are present", () => {
    const decision = decideReviewOutcome({
      review: withFindings(
        { code: "excessive_suspense", severity: "major", note: "tense" },
        { code: "unsafe_content", severity: "blocking", note: "unsafe" },
      ),
      config: DEFAULT_CONFIG,
      revisionsUsed: 0,
    });
    expect(decision.kind).toBe("block");
  });
});

describe("decideReviewOutcome — revise is bounded at two", () => {
  const majorReview = withFindings({
    code: "excessive_suspense",
    severity: "major",
    note: "too tense for bedtime",
  });

  it("revises while the budget remains", () => {
    expect(
      decideReviewOutcome({
        review: majorReview,
        config: DEFAULT_CONFIG,
        revisionsUsed: 0,
      }).kind,
    ).toBe("revise");
    expect(
      decideReviewOutcome({
        review: majorReview,
        config: DEFAULT_CONFIG,
        revisionsUsed: 1,
      }).kind,
    ).toBe("revise");
  });

  it("fails safely (not block, not publish) once the budget is spent", () => {
    const decision = decideReviewOutcome({
      review: majorReview,
      config: DEFAULT_CONFIG,
      revisionsUsed: MAX_AUTOMATIC_REVISIONS,
    });
    expect(decision.kind).toBe("fail");
  });

  it.each([
    ["completeArc", { completeArc: false }],
    ["resolvesCentralProblem", { resolvesCentralProblem: false }],
    ["endsCalmly", { endsCalmly: false }],
    ["sequelDependency", { sequelDependency: true }],
    ["ageAppropriate", { ageAppropriate: false }],
  ] as const)("revises on a failed checklist flag: %s", (_name, patch) => {
    const decision = decideReviewOutcome({
      review: { ...CLEAN, ...patch },
      config: DEFAULT_CONFIG,
      revisionsUsed: 0,
    });
    expect(decision.kind).toBe("revise");
  });
});

describe("decideReviewOutcome — parent strictness escalates minors", () => {
  it("escalates an excluded-topic minor to revise", () => {
    const decision = decideReviewOutcome({
      review: withFindings({
        code: "excluded_topic_present",
        severity: "minor",
        note: "mentions an excluded topic",
      }),
      config: DEFAULT_CONFIG,
      revisionsUsed: 0,
    });
    expect(decision.kind).toBe("revise");
  });

  it("escalates a peril minor only when mild peril is disallowed", () => {
    const perilReview = withFindings({
      code: "peril_not_permitted",
      severity: "minor",
      note: "a moment of danger",
    });
    expect(
      decideReviewOutcome({
        review: perilReview,
        config: { ...DEFAULT_CONFIG, allowMildPeril: true },
        revisionsUsed: 0,
      }).kind,
    ).toBe("approve");
    expect(
      decideReviewOutcome({
        review: perilReview,
        config: { ...DEFAULT_CONFIG, allowMildPeril: false },
        revisionsUsed: 0,
      }).kind,
    ).toBe("revise");
  });

  it("a calm-only family escalates a suspense minor to revise", () => {
    const suspenseReview = withFindings({
      code: "excessive_suspense",
      severity: "minor",
      note: "a little tense",
    });
    expect(
      decideReviewOutcome({
        review: suspenseReview,
        config: { ...DEFAULT_CONFIG, maxSuspense: "calm" },
        revisionsUsed: 0,
      }).kind,
    ).toBe("revise");
    expect(
      decideReviewOutcome({
        review: suspenseReview,
        config: { ...DEFAULT_CONFIG, maxSuspense: "mild" },
        revisionsUsed: 0,
      }).kind,
    ).toBe("approve");
  });
});

describe("finding vocabulary", () => {
  it("keeps the blocking codes inside the published vocabulary", () => {
    for (const code of BLOCKING_CODES) {
      expect(REVIEW_FINDING_CODES).toContain(code);
    }
  });
});
