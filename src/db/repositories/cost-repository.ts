import { and, eq, sql } from "drizzle-orm";

import type {
  CostRepository,
  StoryCostReport,
  TextCostByOutcome,
} from "@/application/ports/cost-repository";
import type { GenerationOutcome } from "@/domain/generation-run";
import type { Database } from "../client";
import {
  generationRuns,
  imageGenerationRuns,
  workflowExecutions,
} from "../schema";

/**
 * Drizzle impl of {@link CostRepository}. Sums EVERY attempt row (rejected/failed
 * intermediate attempts included), so retries/repair/escalation are counted — a
 * cheap-but-failing route cannot look artificially inexpensive
 * (`docs/06-engineering/cost-management.md` acceptance: "A cheap but failure-prone
 * model cannot appear artificially inexpensive").
 */

const RETRY_TEXT_OUTCOMES: GenerationOutcome[] = [
  "repaired",
  "regenerated",
  "rejected",
  "failed",
];

export function createCostRepository(db: Database): CostRepository {
  return {
    async storyCost(familyId, storyId): Promise<StoryCostReport> {
      // Text: join runs → their workflow, attribute by the workflow's entity id
      // (all story/chapter workflows set entity_id = storyId). Group by outcome.
      const textRows = await db
        .select({
          outcome: generationRuns.outcome,
          cost: sql<number>`coalesce(sum(${generationRuns.estimatedCostMinorUnits}), 0)`,
          n: sql<number>`count(*)`,
        })
        .from(generationRuns)
        .innerJoin(
          workflowExecutions,
          eq(generationRuns.workflowId, workflowExecutions.id),
        )
        .where(
          and(
            eq(generationRuns.familyId, familyId),
            eq(workflowExecutions.entityId, storyId),
          ),
        )
        .groupBy(generationRuns.outcome);

      const textByOutcome: TextCostByOutcome = {
        accepted: 0,
        repaired: 0,
        regenerated: 0,
        rejected: 0,
        failed: 0,
      };
      let textAttempts = 0;
      for (const row of textRows) {
        const outcome = row.outcome as GenerationOutcome;
        textByOutcome[outcome] = Number(row.cost);
        textAttempts += Number(row.n);
      }
      const textCostMinorUnits = Object.values(textByOutcome).reduce(
        (a, b) => a + b,
        0,
      );

      // Image: attributed by story_id directly. Group by ladder phase.
      const imageRows = await db
        .select({
          phase: imageGenerationRuns.phase,
          cost: sql<number>`coalesce(sum(${imageGenerationRuns.estimatedCostMinorUnits}), 0)`,
          n: sql<number>`count(*)`,
        })
        .from(imageGenerationRuns)
        .where(
          and(
            eq(imageGenerationRuns.familyId, familyId),
            eq(imageGenerationRuns.storyId, storyId),
          ),
        )
        .groupBy(imageGenerationRuns.phase);

      const imageByPhase = { initial: 0, repair: 0, escalation: 0 };
      let imageAttempts = 0;
      for (const row of imageRows) {
        const phase = row.phase as keyof typeof imageByPhase;
        if (phase in imageByPhase) imageByPhase[phase] = Number(row.cost);
        imageAttempts += Number(row.n);
      }
      const imageCostMinorUnits =
        imageByPhase.initial + imageByPhase.repair + imageByPhase.escalation;

      const retryCostMinorUnits =
        RETRY_TEXT_OUTCOMES.reduce((s, o) => s + textByOutcome[o], 0) +
        imageByPhase.repair +
        imageByPhase.escalation;

      return {
        storyId,
        textCostMinorUnits,
        imageCostMinorUnits,
        totalMinorUnits: textCostMinorUnits + imageCostMinorUnits,
        textAttempts,
        imageAttempts,
        textByOutcome,
        imageByPhase,
        retryCostMinorUnits,
      };
    },
  };
}
