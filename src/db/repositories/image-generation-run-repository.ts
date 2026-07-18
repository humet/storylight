import { asc, eq } from "drizzle-orm";

import type {
  ImageGenerationRunRepository,
  ImageRunKind,
  ImageRunRecord,
  RecordImageRunInput,
} from "@/application/ports/image-generation-run-repository";
import type { ImageCapability } from "@/domain/model-capability";
import { nameBasedUuid } from "@/domain/name-uuid";
import type { Database } from "../client";
import { imageGenerationRuns } from "../schema";

/**
 * Drizzle implementation of {@link ImageGenerationRunRepository}. Idempotent via a
 * deterministic name-based id over `(workflowId, stageKey, phase, kind)` +
 * `onConflictDoNothing`, so a crash-and-retry re-records the SAME cost row instead
 * of double-counting spend (`docs/06-engineering/cost-management.md`).
 */
export function createImageGenerationRunRepository(
  db: Database,
): ImageGenerationRunRepository {
  return {
    async recordImageRun(input: RecordImageRunInput) {
      const id = await nameBasedUuid(
        "image-generation-run",
        input.workflowId,
        input.stageKey,
        input.phase,
        input.kind,
      );
      await db
        .insert(imageGenerationRuns)
        .values({
          id,
          familyId: input.familyId ?? null,
          storyId: input.storyId ?? null,
          specId: input.specId ?? null,
          workflowId: input.workflowId,
          stageKey: input.stageKey,
          capability: input.capability,
          phase: input.phase,
          kind: input.kind,
          target: input.target,
          resolvedModelId: input.resolvedModelId,
          routeVersion: input.routeVersion,
          seed: input.seed ?? null,
          outcome: input.outcome,
          failureKind: input.failureKind ?? null,
          imageCount: input.imageCount,
          estimatedCostMinorUnits: input.estimatedCostMinorUnits,
          latencyMs: input.latencyMs,
        })
        .onConflictDoNothing({
          target: [
            imageGenerationRuns.workflowId,
            imageGenerationRuns.stageKey,
            imageGenerationRuns.phase,
            imageGenerationRuns.kind,
          ],
        });
    },

    async listRunsForWorkflow(workflowId): Promise<ImageRunRecord[]> {
      const rows = await db
        .select()
        .from(imageGenerationRuns)
        .where(eq(imageGenerationRuns.workflowId, workflowId))
        .orderBy(asc(imageGenerationRuns.createdAt));
      return rows.map((row) => ({
        id: row.id,
        specId: row.specId,
        capability: row.capability as ImageCapability,
        phase: row.phase,
        kind: row.kind as ImageRunKind,
        outcome: row.outcome,
        estimatedCostMinorUnits: row.estimatedCostMinorUnits,
        imageCount: row.imageCount,
      }));
    },
  };
}

/** Convenience factory resolving the process database first (mirrors siblings). */
export async function getImageGenerationRunRepository(): Promise<ImageGenerationRunRepository> {
  const { getDb } = await import("../client");
  return createImageGenerationRunRepository(await getDb());
}
