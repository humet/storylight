import type { EvaluationApproval, EvaluationReport } from "@/domain/evaluation";
import type { LanguageCapability } from "@/domain/model-capability";

/**
 * PORT over the evaluation tables (`docs/03-ai/evaluation.md`). Owned by the
 * application; the Drizzle impl lives in
 * `src/db/repositories/evaluation-repository.ts`. Reports and approvals are
 * append-mostly records (an approval is only ever superseded, never edited).
 */

export interface RecordReportInput {
  /** Provide to make recording idempotent (a resume/re-run reuses the id). */
  id?: string;
  routeVersionId: string | null;
  capability: LanguageCapability | null;
  fixtureSetId: string;
  fixtureSetVersion: string;
  environment: EvaluationReport["environment"];
  summary: EvaluationReport["summary"];
  createdBy: string;
}

export interface RecordApprovalInput {
  id?: string;
  routeVersionId: string;
  reportId: string;
  approvedBy: string;
  environment: EvaluationApproval["environment"];
  note?: string;
}

export interface EvaluationRepository {
  recordReport(input: RecordReportInput): Promise<EvaluationReport>;
  getReport(id: string): Promise<EvaluationReport | null>;
  listReportsForRoute(routeVersionId: string): Promise<EvaluationReport[]>;

  /**
   * Record a new LIVE approval for a route version, superseding any prior live
   * approval for that route in the SAME transaction (the partial-unique index
   * enforces at most one live approval per route). Idempotent on `id`.
   */
  recordApproval(input: RecordApprovalInput): Promise<EvaluationApproval>;

  /** The single LIVE (non-superseded) approval for a route version, or null. */
  getLiveApproval(routeVersionId: string): Promise<EvaluationApproval | null>;

  listApprovalsForRoute(routeVersionId: string): Promise<EvaluationApproval[]>;

  /** Mark every live approval for a route superseded (e.g. on deprecation). */
  supersedeApprovals(routeVersionId: string): Promise<void>;
}
