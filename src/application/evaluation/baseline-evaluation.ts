import type { EvaluationSummary } from "@/domain/evaluation";
import type { LanguageCapability } from "@/domain/model-capability";

/**
 * The M10 LOCAL-FAKE EVALUATION BASELINE (source of truth for the seed migration,
 * `docs/03-ai/evaluation.md`). This TS module mirrors the rows the migration
 * inserts; `baseline-evaluation.test.ts` (and the DB seed integration test) guard
 * the two against drift — exactly the pattern `default-model-routes.ts` uses.
 *
 * WHY IT EXISTS: the exit criterion "every active model route has an evaluation
 * approval" must hold from an empty-then-migrated database (the state CI + every
 * integration test starts from). M6 seeded the 9 routes `active` with a BOOTSTRAP
 * approval record; M10 REPLACES that with a real {@link EvaluationApproval} row
 * linking each route to this baseline report and marks the bootstrap record
 * superseded. The report's `environment` is `local-fake` — HONEST provenance: it
 * was produced by the evaluation runner over the source-controlled fixture set on
 * the scriptable fakes (no paid call). Re-running `pnpm eval` with a real gateway
 * key produces fresh `gateway` reports/approvals that supersede this baseline.
 *
 * The `SUMMARY` below is the EXACT output of
 * `createEvaluationRunner(...).run({ environment: "local-fake" })` over
 * `STORYLIGHT_CORE_FIXTURES` with the dev-fixture language model — reproduced by
 * `baseline-evaluation.test.ts`, not hand-invented numbers.
 */

export const BASELINE_REPORT_ID = "e3268581-ab72-50b7-8c40-d3dd5f901dc6";
export const BASELINE_FIXTURE_SET_ID = "storylight-core";
export const BASELINE_FIXTURE_SET_VERSION = "1.0.0";
export const BASELINE_APPROVED_BY = "owner:storylight";
export const BASELINE_CREATED_BY = "system:m10-baseline";
export const BASELINE_APPROVED_AT = "2026-07-18T00:00:00.000Z";

/** The exact runner output over the core fixtures on the dev-fixture model. */
export const BASELINE_SUMMARY: EvaluationSummary = {
  totalCases: 14,
  passedCases: 14,
  blockedCases: 0,
  blockingCodes: [],
  dimensions: [
    { dimension: "deterministic", total: 21, passed: 21, passRate: 1 },
    { dimension: "safety", total: 5, passed: 5, passRate: 1 },
    { dimension: "domain-quality", total: 8, passed: 8, passRate: 1 },
    { dimension: "product-experience", total: 0, passed: 0, passRate: null },
    { dimension: "cost-latency", total: 5, passed: 5, passRate: 1 },
  ],
  totalCostMinorUnits: 5,
  p95LatencyMs: 5,
  failedCaseIds: [],
};

/** One approval per active route: `(capability, route id, approval id)`. */
export interface BaselineApprovalSeed {
  capability: LanguageCapability;
  routeVersionId: string;
  approvalId: string;
}

export const BASELINE_APPROVALS: BaselineApprovalSeed[] = [
  {
    capability: "one-off-planning",
    routeVersionId: "b5cefd48-c5c8-5d0f-a81c-c357a9f1dd32",
    approvalId: "612f188a-e341-501e-81a6-f15d52c39bff",
  },
  {
    capability: "series-planning",
    routeVersionId: "02a38cf0-3d3f-51c0-83c4-f3ce39ee2778",
    approvalId: "a8cb29e9-6cd9-5e78-b7ba-4148d25227a1",
  },
  {
    capability: "chapter-planning",
    routeVersionId: "d0ff797a-1ddc-52ff-9a95-796812b5d71f",
    approvalId: "0fb5d076-8aa1-5e60-9399-eb373aade09e",
  },
  {
    capability: "chapter-writing",
    routeVersionId: "9a04a6c5-9cb3-51da-b40c-1f17feac5bd9",
    approvalId: "ecfb5388-b794-517b-a782-423b86c3a0cd",
  },
  {
    capability: "chapter-review",
    routeVersionId: "091e716d-93e6-5b7c-aa69-9b09ec1032e1",
    approvalId: "772ad312-102c-5db2-aae5-6bcc27fd2d8d",
  },
  {
    capability: "chapter-revision",
    routeVersionId: "cb558c87-6593-553e-9f24-2de420cb9524",
    approvalId: "6afaa42f-abc7-55d0-bec5-a458aa12118e",
  },
  {
    capability: "continuity-extraction",
    routeVersionId: "dac4a447-9aec-5c02-bbfe-501fd79c9837",
    approvalId: "b2d82d01-826f-500d-af7d-50e65d1f76e2",
  },
  {
    capability: "illustration-planning",
    routeVersionId: "fd4d2bd5-cf23-5ee9-963d-d57268d5e88d",
    approvalId: "d79beb54-33ca-56f3-946e-031f6ecb6638",
  },
  {
    capability: "illustration-review",
    routeVersionId: "461e843a-be7c-5b0e-b092-7a98fb5b1f6e",
    approvalId: "5aecab56-d9ea-56d0-8810-73b935a31782",
  },
];
