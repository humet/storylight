import { describe, expect, it } from "vitest";

import {
  casePassed,
  caseBlocked,
  compareReports,
  type EvaluationCaseResult,
  type EvaluationCheck,
  p95,
  passesBlockingGate,
  summariseEvaluation,
} from "./evaluation";

function check(over: Partial<EvaluationCheck>): EvaluationCheck {
  return {
    checkId: over.checkId ?? "c",
    dimension: over.dimension ?? "deterministic",
    passed: over.passed ?? true,
    blocking: over.blocking,
    detail: over.detail,
  };
}

function caseResult(over: Partial<EvaluationCaseResult>): EvaluationCaseResult {
  return {
    caseId: over.caseId ?? "case",
    category: over.category ?? "ordinary",
    checks: over.checks ?? [check({})],
    costMinorUnits: over.costMinorUnits ?? 100,
    latencyMs: over.latencyMs ?? 50,
  };
}

describe("summariseEvaluation — blocking failures are never averaged away", () => {
  it("a case with one blocking failure fails the case AND the gate, however good its other checks", () => {
    const result = caseResult({
      caseId: "identity-case",
      checks: [
        check({
          checkId: "word-count",
          dimension: "deterministic",
          passed: true,
        }),
        check({
          checkId: "read-aloud",
          dimension: "domain-quality",
          passed: true,
        }),
        check({
          checkId: "child-identity",
          dimension: "safety",
          passed: false,
          blocking: "wrong-child-identity",
        }),
      ],
    });
    expect(casePassed(result)).toBe(false);
    expect(caseBlocked(result)).toBe(true);

    const summary = summariseEvaluation([result]);
    expect(summary.blockedCases).toBe(1);
    expect(summary.blockingCodes).toContain("wrong-child-identity");
    expect(summary.passedCases).toBe(0);
    // The safety dimension records the failure — it is NOT hidden by the passing
    // deterministic/quality checks.
    const safety = summary.dimensions.find((d) => d.dimension === "safety");
    expect(safety?.passRate).toBe(0);
    // The gate rejects any blocked case regardless of averages.
    expect(passesBlockingGate(summary)).toBe(false);
  });

  it("a clean fixture set passes the blocking gate", () => {
    const summary = summariseEvaluation([
      caseResult({ caseId: "a" }),
      caseResult({ caseId: "b" }),
    ]);
    expect(summary.blockedCases).toBe(0);
    expect(passesBlockingGate(summary)).toBe(true);
  });
});

describe("p95", () => {
  it("is 0 for empty and the nearest-rank value otherwise", () => {
    expect(p95([])).toBe(0);
    expect(p95([10])).toBe(10);
    expect(p95([1, 2, 3, 4, 5, 6, 7, 8, 9, 100])).toBe(100);
  });
});

describe("compareReports — the release gate", () => {
  const baseline = summariseEvaluation([
    caseResult({ caseId: "a", costMinorUnits: 100, latencyMs: 100 }),
    caseResult({ caseId: "b", costMinorUnits: 100, latencyMs: 100 }),
  ]);

  it("allows a cheaper candidate that holds quality and regresses nothing", () => {
    const candidate = summariseEvaluation([
      caseResult({ caseId: "a", costMinorUnits: 40, latencyMs: 100 }),
      caseResult({ caseId: "b", costMinorUnits: 40, latencyMs: 100 }),
    ]);
    const decision = compareReports(baseline, candidate);
    expect(decision.canReplace).toBe(true);
    expect(decision.regressions).toEqual([]);
  });

  it("blocks a candidate that regresses a previously-passing fixture", () => {
    const candidate = summariseEvaluation([
      caseResult({ caseId: "a", costMinorUnits: 40 }),
      caseResult({
        caseId: "b",
        checks: [
          check({
            checkId: "continuity",
            dimension: "safety",
            passed: false,
            blocking: "continuity-contradiction",
          }),
        ],
      }),
    ]);
    const decision = compareReports(baseline, candidate);
    expect(decision.canReplace).toBe(false);
    expect(decision.regressions).toContain("b");
  });

  it("blocks a candidate with a blocking failure even if cheaper", () => {
    const candidate = summariseEvaluation([
      caseResult({
        caseId: "a",
        costMinorUnits: 1,
        checks: [
          check({
            checkId: "safety",
            dimension: "safety",
            passed: false,
            blocking: "unsafe-content",
          }),
        ],
      }),
      caseResult({ caseId: "b", costMinorUnits: 1 }),
    ]);
    const decision = compareReports(baseline, candidate);
    expect(decision.canReplace).toBe(false);
  });
});
