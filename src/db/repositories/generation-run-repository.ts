import { and, asc, eq } from "drizzle-orm";

import type {
  GenerationArtifactRecord,
  GenerationRunRecord,
  GenerationRunRepository,
  RecordGenerationInput,
} from "@/application/ports/generation-run-repository";
import type {
  GenerationFailureKind,
  GenerationOutcome,
  RepairPhase,
} from "@/domain/generation-run";
import type { LanguageCapability } from "@/domain/model-capability";
import { nameBasedUuid } from "@/domain/name-uuid";
import type { Database } from "../client";
import { generationArtifacts, generationRuns } from "../schema";

/**
 * Drizzle implementation of {@link GenerationRunRepository}. Recording is
 * IDEMPOTENT: ids are deterministic name-based UUIDs over `(workflowId, stageKey
 * [, attemptIndex])` and every insert is `onConflictDoNothing`, so a stage
 * crash-and-retry re-records the SAME rows rather than duplicating the audit
 * trail (the M5 stage idempotency contract). The full raw model output is never
 * written — only usage, lineage, outcome, and the validated artifact.
 */

type RunRow = typeof generationRuns.$inferSelect;
type ArtifactRow = typeof generationArtifacts.$inferSelect;

function toRun(row: RunRow): GenerationRunRecord {
  return {
    id: row.id,
    workflowId: row.workflowId ?? null,
    stageKey: row.stageKey ?? null,
    capability: row.capability as LanguageCapability,
    modelRouteVersionId: row.modelRouteVersionId ?? null,
    routeVersion: row.routeVersion,
    resolvedModelId: row.resolvedModelId,
    target: row.target,
    promptVersion: row.promptVersion,
    schemaVersion: row.schemaVersion,
    attemptIndex: row.attemptIndex,
    parentAttemptIndex: row.parentAttemptIndex ?? null,
    phase: row.phase as RepairPhase,
    outcome: row.outcome as GenerationOutcome,
    failureKind: (row.failureKind as GenerationFailureKind | null) ?? null,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    totalTokens: row.totalTokens,
    estimatedCostMinorUnits: row.estimatedCostMinorUnits,
    latencyMs: row.latencyMs,
    artifactRef: row.artifactRef ?? null,
  };
}

function toArtifact(row: ArtifactRow): GenerationArtifactRecord {
  return {
    id: row.id,
    workflowId: row.workflowId ?? null,
    stageKey: row.stageKey ?? null,
    schemaVersion: row.schemaVersion,
    kind: row.kind,
    payload: row.payload,
  };
}

export function createGenerationRunRepository(
  db: Database,
): GenerationRunRepository {
  return {
    async recordGeneration(input: RecordGenerationInput) {
      let artifactId: string | null = null;

      if (input.artifact) {
        artifactId = await nameBasedUuid(
          "generation-artifact",
          input.workflowId,
          input.stageKey,
        );
        await db
          .insert(generationArtifacts)
          .values({
            id: artifactId,
            familyId: input.familyId ?? null,
            workflowId: input.workflowId,
            stageKey: input.stageKey,
            schemaVersion: input.artifact.schemaVersion,
            kind: input.artifact.kind,
            payload: input.artifact.payload,
          })
          .onConflictDoNothing({
            target: [
              generationArtifacts.workflowId,
              generationArtifacts.stageKey,
            ],
          });
      }

      const runIds: string[] = [];
      for (const attempt of input.attempts) {
        const runId = await nameBasedUuid(
          "generation-run",
          input.workflowId,
          input.stageKey,
          String(attempt.attemptIndex),
        );
        runIds.push(runId);
        await db
          .insert(generationRuns)
          .values({
            id: runId,
            familyId: input.familyId ?? null,
            workflowId: input.workflowId,
            stageKey: input.stageKey,
            capability: attempt.capability,
            modelRouteVersionId: attempt.modelRouteVersionId,
            routeVersion: attempt.routeVersion,
            resolvedModelId: attempt.resolvedModelId,
            target: attempt.target,
            promptVersion: attempt.promptVersion,
            schemaVersion: attempt.schemaVersion,
            attemptIndex: attempt.attemptIndex,
            parentAttemptIndex: attempt.parentAttemptIndex,
            phase: attempt.phase,
            outcome: attempt.outcome,
            failureKind: attempt.failureKind ?? null,
            inputTokens: attempt.usage.inputTokens,
            outputTokens: attempt.usage.outputTokens,
            totalTokens: attempt.usage.totalTokens,
            estimatedCostMinorUnits: attempt.estimatedCostMinorUnits,
            latencyMs: attempt.latencyMs,
            artifactRef:
              input.acceptedAttemptIndex === attempt.attemptIndex
                ? artifactId
                : null,
          })
          .onConflictDoNothing({
            target: [
              generationRuns.workflowId,
              generationRuns.stageKey,
              generationRuns.attemptIndex,
            ],
          });
      }

      return { artifactId, runIds };
    },

    async listRunsForWorkflow(workflowId) {
      const rows = await db
        .select()
        .from(generationRuns)
        .where(eq(generationRuns.workflowId, workflowId))
        .orderBy(asc(generationRuns.attemptIndex));
      return rows.map(toRun);
    },

    async getArtifact(workflowId, stageKey) {
      // Filter BOTH keys in SQL: a workflow may have artifacts for several stages,
      // so a workflow-only WHERE + LIMIT 1 could return the wrong stage's row. The
      // unique(workflow, stage) index means at most one row matches both.
      const [row] = await db
        .select()
        .from(generationArtifacts)
        .where(
          and(
            eq(generationArtifacts.workflowId, workflowId),
            eq(generationArtifacts.stageKey, stageKey),
          ),
        )
        .limit(1);
      if (!row) return null;
      return toArtifact(row);
    },
  };
}
