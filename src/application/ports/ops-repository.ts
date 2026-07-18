import type { GenerationOutcome } from "@/domain/generation-run";

/**
 * READ PORT for the internal OPS SUMMARY (`docs/06-engineering/observability.md`
 * "Metrics", "Dashboards"). Computes a raw metric snapshot for one family from
 * existing tables (workflow executions + generation/image runs + illustration
 * publications) — NO external service. The impl lives in
 * `src/db/repositories/ops-repository.ts`; the ops query service shapes this into
 * rates + alert metrics.
 */
export interface OpsSnapshot {
  /** Workflow counts by status (in this family). */
  workflowsByStatus: Record<string, number>;
  /** Text-generation attempt counts by outcome (all runs, incl. retries). */
  textByOutcome: Record<GenerationOutcome, number>;
  /** Text runs where the failure was a budget breach. */
  budgetBreaches: number;
  /** Continuity-extraction attempts by outcome (rejection-rate numerator/denominator). */
  continuityByOutcome: Record<GenerationOutcome, number>;
  /** Revision-capability runs (review revision proxy). */
  revisionRuns: number;
  /** Text-run latencies (ms) for a p95 (bounded per family). */
  textLatenciesMs: number[];
  /** Accepted-result cost, minor units (text + image, all attempts). */
  textCostMinorUnits: number;
  imageCostMinorUnits: number;
  /** Illustration publication states (identity-failure proxy = manual-review/failed). */
  illustrationsByState: Record<string, number>;
  /** Workflows dead-lettered with a SAFETY_REJECTION. */
  safetyFailures: number;
  /** Queued + waiting workflows (backlog). */
  backlogJobs: number;
}

export interface OpsRepository {
  snapshot(familyId: string): Promise<OpsSnapshot>;
}
