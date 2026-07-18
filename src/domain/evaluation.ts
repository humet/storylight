import type { LanguageCapability } from "./model-capability";

/**
 * EVALUATION domain (`docs/03-ai/evaluation.md`). Pure types + pure aggregation.
 *
 * The principle: no prompt, model, schema, or image route reaches production
 * because of a few impressive examples. A route is evaluated across a
 * source-controlled fixture set on five axes — deterministic correctness, safety,
 * domain quality, product experience, and accepted cost/latency — and BLOCKING
 * FAILURES ARE NEVER AVERAGED AWAY: a single blocking failure fails the case (and
 * the report) no matter how well every other check scored.
 *
 * This module is pure: the runner (application) produces {@link EvaluationCaseResult}s
 * by exercising a route against fixtures; the pure `summariseEvaluation` folds
 * them into an {@link EvaluationReport}; the pure `compareReports` applies the
 * release gate (`evaluation.md` "Release gate") to decide whether a candidate may
 * replace a baseline.
 */

/** The five evaluation axes (`evaluation.md` "Principle"). */
export type EvaluationDimension =
  | "deterministic"
  | "safety"
  | "domain-quality"
  | "product-experience"
  | "cost-latency";

export const EVALUATION_DIMENSIONS: readonly EvaluationDimension[] = [
  "deterministic",
  "safety",
  "domain-quality",
  "product-experience",
  "cost-latency",
];

/**
 * The closed set of BLOCKING failures (`evaluation.md` "Blocking failures"). Any
 * one of these on a case fails it outright — it is never averaged with passing
 * checks. Rejected content is never returned by reader APIs (domain rule 9), so a
 * route that produces any of these cannot be approved.
 */
export const BLOCKING_FAILURE_CODES = [
  "unsafe-content",
  "wrong-child-identity",
  "wrong-child-count",
  "continuity-contradiction",
  "unresolved-series-thread",
  "wrong-chapter",
  "premature-ending-reveal",
  "invalid-canonical-output",
  "hidden-prompt-exposure",
] as const;

export type BlockingFailureCode = (typeof BLOCKING_FAILURE_CODES)[number];

/** A single evaluated check on one fixture case. */
export interface EvaluationCheck {
  /** Stable id (e.g. "word-count", "schema", "thread-lifecycle"). */
  checkId: string;
  dimension: EvaluationDimension;
  passed: boolean;
  /**
   * When failed AND this failure is a blocking one, the blocking code. A failed
   * non-blocking check (a quality/experience shortfall) has `blocking: undefined`
   * and only lowers the dimension pass rate.
   */
  blocking?: BlockingFailureCode;
  /** Safe, id/code-level detail — never prose, prompts, or provider errors. */
  detail?: string;
}

/** The result of evaluating ONE fixture case. */
export interface EvaluationCaseResult {
  caseId: string;
  /** The fixture category (e.g. "prompt-injection", "possession-transfer"). */
  category: string;
  checks: EvaluationCheck[];
  /** Accepted-result cost of producing this case's output, in minor units. */
  costMinorUnits: number;
  /** Wall-clock latency to the accepted result, in ms. */
  latencyMs: number;
}

/** Blocking failures on a case (never averaged away). */
export function blockingFailures(
  result: EvaluationCaseResult,
): EvaluationCheck[] {
  return result.checks.filter((c) => !c.passed && c.blocking !== undefined);
}

/** A case passes iff no check failed (blocking OR non-blocking). */
export function casePassed(result: EvaluationCaseResult): boolean {
  return result.checks.every((c) => c.passed);
}

/** A case is BLOCKED iff it has at least one blocking failure. */
export function caseBlocked(result: EvaluationCaseResult): boolean {
  return blockingFailures(result).length > 0;
}

export interface DimensionSummary {
  dimension: EvaluationDimension;
  total: number;
  passed: number;
  /** null when the dimension has no checks in this report. */
  passRate: number | null;
}

/**
 * The persisted, source-controllable summary of an evaluation run over a fixture
 * set against one route version. This is what an {@link EvaluationReport} stores.
 */
export interface EvaluationSummary {
  totalCases: number;
  passedCases: number;
  /** Cases with ≥1 blocking failure. A non-zero count is a hard fail of the gate. */
  blockedCases: number;
  /** Distinct blocking codes observed (for the failure gallery). */
  blockingCodes: BlockingFailureCode[];
  dimensions: DimensionSummary[];
  /** Sum of accepted-result cost across all cases (includes retries/repair). */
  totalCostMinorUnits: number;
  /** p95 accepted-result latency across cases, in ms. */
  p95LatencyMs: number;
  /** Case ids that failed (for regression diffing). */
  failedCaseIds: string[];
}

/** Pure p95 over a list of numbers (nearest-rank; 0 for an empty list). */
export function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(0.95 * sorted.length);
  return sorted[Math.min(rank, sorted.length) - 1];
}

/**
 * Fold case results into a summary. Blocking failures are counted separately and
 * NEVER averaged into the dimension pass rates — a blocked case still lowers the
 * `deterministic`/`safety` rates through its failed checks, and independently
 * raises `blockedCases`, which the gate treats as a hard fail.
 */
export function summariseEvaluation(
  results: EvaluationCaseResult[],
): EvaluationSummary {
  const dimensions: DimensionSummary[] = EVALUATION_DIMENSIONS.map(
    (dimension) => {
      let total = 0;
      let passed = 0;
      for (const r of results) {
        for (const c of r.checks) {
          if (c.dimension !== dimension) continue;
          total += 1;
          if (c.passed) passed += 1;
        }
      }
      return {
        dimension,
        total,
        passed,
        passRate: total === 0 ? null : passed / total,
      };
    },
  );

  const blockingCodes = new Set<BlockingFailureCode>();
  const failedCaseIds: string[] = [];
  let passedCases = 0;
  let blockedCases = 0;
  for (const r of results) {
    if (casePassed(r)) passedCases += 1;
    else failedCaseIds.push(r.caseId);
    const blocks = blockingFailures(r);
    if (blocks.length > 0) {
      blockedCases += 1;
      for (const b of blocks) if (b.blocking) blockingCodes.add(b.blocking);
    }
  }

  return {
    totalCases: results.length,
    passedCases,
    blockedCases,
    blockingCodes: [...blockingCodes],
    dimensions,
    totalCostMinorUnits: results.reduce((s, r) => s + r.costMinorUnits, 0),
    p95LatencyMs: p95(results.map((r) => r.latencyMs)),
    failedCaseIds,
  };
}

/**
 * Whether a summary CLEARS the blocking thresholds on its own (independent of any
 * baseline): every case passed and no blocking failures occurred. This is the
 * minimum bar for a route to be APPROVED for activation (`evaluation.md`).
 */
export function passesBlockingGate(summary: EvaluationSummary): boolean {
  return (
    summary.blockedCases === 0 && summary.passedCases === summary.totalCases
  );
}

/** The pairwise verdict of comparing a candidate report against a baseline. */
export interface ReleaseGateDecision {
  /** May the candidate REPLACE the baseline as the active route? */
  canReplace: boolean;
  /** Ordered, safe reasons (pass AND fail) explaining the decision. */
  reasons: string[];
  /** Fixture case ids that regressed (passed in baseline, fail in candidate). */
  regressions: string[];
}

/**
 * The RELEASE GATE (`evaluation.md` "Release gate"): a candidate may replace a
 * baseline only when all blocking thresholds pass, NO case regresses, and quality
 * OR cost/latency improves without the other regressing. Human preference and the
 * human owner approval are recorded separately (the approval row); this pure
 * function decides the machine-checkable half.
 */
export function compareReports(
  baseline: EvaluationSummary,
  candidate: EvaluationSummary,
  baselineFailedCaseIds: string[] = baseline.failedCaseIds,
): ReleaseGateDecision {
  const reasons: string[] = [];

  // 1. Candidate must clear the blocking gate outright.
  const blockingOk = passesBlockingGate(candidate);
  reasons.push(
    blockingOk
      ? "Candidate passes all blocking thresholds."
      : `Candidate has ${candidate.blockedCases} blocked case(s) / ${candidate.totalCases - candidate.passedCases} failing case(s).`,
  );

  // 2. No critical fixture regresses (passed in baseline, fails in candidate).
  const baselineFailed = new Set(baselineFailedCaseIds);
  const regressions = candidate.failedCaseIds.filter(
    (id) => !baselineFailed.has(id),
  );
  reasons.push(
    regressions.length === 0
      ? "No fixture regresses against the baseline."
      : `Regressions: ${regressions.join(", ")}.`,
  );

  // 3. Quality improves OR cost/latency improves, without the other regressing.
  const candidateQuality = candidate.passedCases;
  const baselineQuality = baseline.passedCases;
  const qualityImproved = candidateQuality > baselineQuality;
  const qualityHeld = candidateQuality >= baselineQuality;
  const cheaper = candidate.totalCostMinorUnits < baseline.totalCostMinorUnits;
  const faster = candidate.p95LatencyMs < baseline.p95LatencyMs;
  const costHeld =
    candidate.totalCostMinorUnits <= baseline.totalCostMinorUnits &&
    candidate.p95LatencyMs <= baseline.p95LatencyMs;

  const worthwhile =
    (qualityImproved && costHeld) ||
    ((cheaper || faster) && qualityHeld) ||
    (qualityHeld && costHeld);
  reasons.push(
    worthwhile
      ? "Quality or cost/latency improves without regressing the other."
      : "Neither quality nor cost/latency improves without a regression in the other.",
  );

  return {
    canReplace: blockingOk && regressions.length === 0 && worthwhile,
    reasons,
    regressions,
  };
}

/** Where an evaluation was run — honest provenance (`environment` on the report). */
export type EvaluationEnvironment = "local-fake" | "gateway";

/** A persisted evaluation report (the repository row maps to this). */
export interface EvaluationReport {
  id: string;
  /** The route version this report evaluated, when route-scoped. */
  routeVersionId: string | null;
  /** The capability under evaluation. */
  capability: LanguageCapability | null;
  /** Source-controlled fixture set id + version. */
  fixtureSetId: string;
  fixtureSetVersion: string;
  environment: EvaluationEnvironment;
  summary: EvaluationSummary;
  createdBy: string;
  createdAt: Date;
}

/**
 * The EVALUATION GATE record (`docs/03-ai/models.md` "Evaluation gate"): a route
 * version may only be ACTIVATED when it has a LIVE (non-superseded) approval
 * linking it to a passing report and a human owner. Replaces M6's bootstrap
 * `approval_record` on `model_route_versions`.
 */
export interface EvaluationApproval {
  id: string;
  routeVersionId: string;
  reportId: string;
  approvedBy: string;
  environment: EvaluationEnvironment;
  note: string | null;
  /** Set when a later approval or a deprecation supersedes this one. */
  supersededAt: Date | null;
  approvedAt: Date;
}
