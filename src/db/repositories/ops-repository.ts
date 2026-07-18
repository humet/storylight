import { and, eq, inArray, sql } from "drizzle-orm";

import type {
  OpsRepository,
  OpsSnapshot,
} from "@/application/ports/ops-repository";
import type { GenerationOutcome } from "@/domain/generation-run";
import type { Database } from "../client";
import {
  generationRuns,
  illustrationPublications,
  imageGenerationRuns,
  workflowExecutions,
} from "../schema";

/**
 * Drizzle impl of {@link OpsRepository}. A handful of grouped aggregate queries
 * over existing tables — no external telemetry service (`observability.md`
 * "Dashboards" is realised as a server-rendered ops summary reading the DB).
 */

function emptyOutcomes(): Record<GenerationOutcome, number> {
  return { accepted: 0, repaired: 0, regenerated: 0, rejected: 0, failed: 0 };
}

export function createOpsRepository(db: Database): OpsRepository {
  return {
    async snapshot(familyId): Promise<OpsSnapshot> {
      const wfRows = await db
        .select({
          status: workflowExecutions.status,
          n: sql<number>`count(*)`,
        })
        .from(workflowExecutions)
        .where(eq(workflowExecutions.familyId, familyId))
        .groupBy(workflowExecutions.status);
      const workflowsByStatus: Record<string, number> = {};
      for (const r of wfRows) workflowsByStatus[r.status] = Number(r.n);

      const textRows = await db
        .select({
          outcome: generationRuns.outcome,
          n: sql<number>`count(*)`,
          cost: sql<number>`coalesce(sum(${generationRuns.estimatedCostMinorUnits}),0)`,
        })
        .from(generationRuns)
        .where(eq(generationRuns.familyId, familyId))
        .groupBy(generationRuns.outcome);
      const textByOutcome = emptyOutcomes();
      let textCostMinorUnits = 0;
      for (const r of textRows) {
        textByOutcome[r.outcome as GenerationOutcome] = Number(r.n);
        textCostMinorUnits += Number(r.cost);
      }

      const [{ n: budgetBreaches } = { n: 0 }] = await db
        .select({ n: sql<number>`count(*)` })
        .from(generationRuns)
        .where(
          and(
            eq(generationRuns.familyId, familyId),
            eq(generationRuns.failureKind, "budget-exceeded"),
          ),
        );

      const continuityRows = await db
        .select({
          outcome: generationRuns.outcome,
          n: sql<number>`count(*)`,
        })
        .from(generationRuns)
        .where(
          and(
            eq(generationRuns.familyId, familyId),
            eq(generationRuns.capability, "continuity-extraction"),
          ),
        )
        .groupBy(generationRuns.outcome);
      const continuityByOutcome = emptyOutcomes();
      for (const r of continuityRows) {
        continuityByOutcome[r.outcome as GenerationOutcome] = Number(r.n);
      }

      const [{ n: revisionRuns } = { n: 0 }] = await db
        .select({ n: sql<number>`count(*)` })
        .from(generationRuns)
        .where(
          and(
            eq(generationRuns.familyId, familyId),
            eq(generationRuns.capability, "chapter-revision"),
          ),
        );

      const latencyRows = await db
        .select({ latency: generationRuns.latencyMs })
        .from(generationRuns)
        .where(eq(generationRuns.familyId, familyId));
      const textLatenciesMs = latencyRows.map((r) => r.latency);

      const [{ cost: imageCostMinorUnits } = { cost: 0 }] = await db
        .select({
          cost: sql<number>`coalesce(sum(${imageGenerationRuns.estimatedCostMinorUnits}),0)`,
        })
        .from(imageGenerationRuns)
        .where(eq(imageGenerationRuns.familyId, familyId));

      const illoRows = await db
        .select({
          state: illustrationPublications.state,
          n: sql<number>`count(*)`,
        })
        .from(illustrationPublications)
        .where(eq(illustrationPublications.familyId, familyId))
        .groupBy(illustrationPublications.state);
      const illustrationsByState: Record<string, number> = {};
      for (const r of illoRows) illustrationsByState[r.state] = Number(r.n);

      const [{ n: safetyFailures } = { n: 0 }] = await db
        .select({ n: sql<number>`count(*)` })
        .from(workflowExecutions)
        .where(
          and(
            eq(workflowExecutions.familyId, familyId),
            sql`${workflowExecutions.lastError}->>'code' = 'SAFETY_REJECTION'`,
          ),
        );

      const [{ n: backlogJobs } = { n: 0 }] = await db
        .select({ n: sql<number>`count(*)` })
        .from(workflowExecutions)
        .where(
          and(
            eq(workflowExecutions.familyId, familyId),
            inArray(workflowExecutions.status, ["queued", "waiting"]),
          ),
        );

      return {
        workflowsByStatus,
        textByOutcome,
        budgetBreaches: Number(budgetBreaches),
        continuityByOutcome,
        revisionRuns: Number(revisionRuns),
        textLatenciesMs,
        textCostMinorUnits,
        imageCostMinorUnits: Number(imageCostMinorUnits),
        illustrationsByState,
        safetyFailures: Number(safetyFailures),
        backlogJobs: Number(backlogJobs),
      };
    },
  };
}
