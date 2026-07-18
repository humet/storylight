import { and, desc, eq, isNull } from "drizzle-orm";

import type {
  EvaluationRepository,
  RecordApprovalInput,
  RecordReportInput,
} from "@/application/ports/evaluation-repository";
import type { EvaluationApproval, EvaluationReport } from "@/domain/evaluation";
import type { LanguageCapability } from "@/domain/model-capability";
import { nameBasedUuid } from "@/domain/name-uuid";
import type { Database } from "../client";
import { evaluationApprovals, evaluationReports } from "../schema";

/**
 * Drizzle implementation of {@link EvaluationRepository}. `recordApproval`
 * supersedes any prior live approval AND inserts the new one in ONE transaction,
 * so the partial-unique "one live approval per route" is never transiently
 * violated — a DB constraint backing the application check (AGENTS.md).
 */

type ReportRow = typeof evaluationReports.$inferSelect;
type ApprovalRow = typeof evaluationApprovals.$inferSelect;

function toReport(row: ReportRow): EvaluationReport {
  return {
    id: row.id,
    routeVersionId: row.routeVersionId ?? null,
    capability: (row.capability as LanguageCapability | null) ?? null,
    fixtureSetId: row.fixtureSetId,
    fixtureSetVersion: row.fixtureSetVersion,
    environment: row.environment,
    summary: row.summary,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

function toApproval(row: ApprovalRow): EvaluationApproval {
  return {
    id: row.id,
    routeVersionId: row.routeVersionId,
    reportId: row.reportId,
    approvedBy: row.approvedBy,
    environment: row.environment,
    note: row.note ?? null,
    supersededAt: row.supersededAt ?? null,
    approvedAt: row.approvedAt,
  };
}

export function createEvaluationRepository(db: Database): EvaluationRepository {
  return {
    async recordReport(input: RecordReportInput) {
      const id =
        input.id ??
        (await nameBasedUuid(
          "evaluation-report",
          input.routeVersionId ?? "none",
          input.fixtureSetId,
          input.fixtureSetVersion,
          input.environment,
          new Date().toISOString(),
        ));
      const [row] = await db
        .insert(evaluationReports)
        .values({
          id,
          routeVersionId: input.routeVersionId,
          capability: input.capability,
          fixtureSetId: input.fixtureSetId,
          fixtureSetVersion: input.fixtureSetVersion,
          environment: input.environment,
          summary: input.summary,
          createdBy: input.createdBy,
        })
        .onConflictDoNothing({ target: evaluationReports.id })
        .returning();
      if (row) return toReport(row);
      const [existing] = await db
        .select()
        .from(evaluationReports)
        .where(eq(evaluationReports.id, id))
        .limit(1);
      return toReport(existing);
    },

    async getReport(id) {
      const [row] = await db
        .select()
        .from(evaluationReports)
        .where(eq(evaluationReports.id, id))
        .limit(1);
      return row ? toReport(row) : null;
    },

    async listReportsForRoute(routeVersionId) {
      const rows = await db
        .select()
        .from(evaluationReports)
        .where(eq(evaluationReports.routeVersionId, routeVersionId))
        .orderBy(desc(evaluationReports.createdAt));
      return rows.map(toReport);
    },

    async recordApproval(input: RecordApprovalInput) {
      const id =
        input.id ??
        (await nameBasedUuid(
          "evaluation-approval",
          input.routeVersionId,
          input.reportId,
          new Date().toISOString(),
        ));
      return db.transaction(async (tx) => {
        // Supersede any existing LIVE approval for this route first …
        const now = new Date();
        await tx
          .update(evaluationApprovals)
          .set({ supersededAt: now })
          .where(
            and(
              eq(evaluationApprovals.routeVersionId, input.routeVersionId),
              isNull(evaluationApprovals.supersededAt),
            ),
          );
        // … then insert the new live one (idempotent on id).
        const [row] = await tx
          .insert(evaluationApprovals)
          .values({
            id,
            routeVersionId: input.routeVersionId,
            reportId: input.reportId,
            approvedBy: input.approvedBy,
            environment: input.environment,
            note: input.note ?? null,
          })
          .onConflictDoNothing({ target: evaluationApprovals.id })
          .returning();
        if (row) return toApproval(row);
        const [existing] = await tx
          .select()
          .from(evaluationApprovals)
          .where(eq(evaluationApprovals.id, id))
          .limit(1);
        return toApproval(existing);
      });
    },

    async getLiveApproval(routeVersionId) {
      const [row] = await db
        .select()
        .from(evaluationApprovals)
        .where(
          and(
            eq(evaluationApprovals.routeVersionId, routeVersionId),
            isNull(evaluationApprovals.supersededAt),
          ),
        )
        .limit(1);
      return row ? toApproval(row) : null;
    },

    async listApprovalsForRoute(routeVersionId) {
      const rows = await db
        .select()
        .from(evaluationApprovals)
        .where(eq(evaluationApprovals.routeVersionId, routeVersionId))
        .orderBy(desc(evaluationApprovals.approvedAt));
      return rows.map(toApproval);
    },

    async supersedeApprovals(routeVersionId) {
      await db
        .update(evaluationApprovals)
        .set({ supersededAt: new Date() })
        .where(
          and(
            eq(evaluationApprovals.routeVersionId, routeVersionId),
            isNull(evaluationApprovals.supersededAt),
          ),
        );
    },
  };
}
