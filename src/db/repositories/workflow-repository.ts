import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";

import type {
  AdvanceStageInput,
  ClaimInput,
  CompleteStageInput,
  CreateExecutionInput,
  RecordFailureInput,
  RecordRetryInput,
  StageOutputRecord,
  WorkflowRepository,
} from "@/application/ports/workflow-repository";
import type { WorkflowError, WorkflowExecution } from "@/domain/workflow";
import type { Database } from "../client";
import { workflowExecutions, workflowStageOutputs } from "../schema";

/**
 * Drizzle implementation of {@link WorkflowRepository}. Only this layer knows the
 * table shape; it maps rows to pure domain types (AGENTS.md). It is the
 * authoritative home of Storylight's workflow state — the idempotent create, the
 * atomic "persist output + advance", the lease/visibility-timeout claim, and the
 * retry/dead-letter writes all live here as guarded SQL, so correctness rests on
 * database constraints, not application checks alone.
 */

type ExecutionRow = typeof workflowExecutions.$inferSelect;
type StageOutputRow = typeof workflowStageOutputs.$inferSelect;

function toExecution(row: ExecutionRow): WorkflowExecution {
  return {
    id: row.id,
    type: row.workflowType,
    status: row.status,
    requestId: row.requestId,
    familyId: row.familyId,
    userId: row.userId,
    entityId: row.entityId ?? undefined,
    currentStage: row.currentStage,
    attempt: row.attempt,
    input: row.input,
    lastError: (row.lastError as WorkflowError | null) ?? undefined,
    leaseOwner: row.leaseOwner ?? undefined,
    leaseExpiresAt: row.leaseExpiresAt ?? undefined,
    nextAttemptAt: row.nextAttemptAt ?? undefined,
    createdAt: row.createdAt,
    startedAt: row.startedAt ?? undefined,
    completedAt: row.completedAt ?? undefined,
    updatedAt: row.updatedAt,
  };
}

function toStageOutput(row: StageOutputRow): StageOutputRecord {
  return {
    workflowId: row.workflowId,
    stageKey: row.stageKey,
    output: row.output,
    attempt: row.attempt,
    promptVersion: row.promptVersion ?? undefined,
    schemaVersion: row.schemaVersion ?? undefined,
    modelRouteVersion: row.modelRouteVersion ?? undefined,
    usage: row.usage ?? undefined,
    latencyMs: row.latencyMs ?? undefined,
    createdAt: row.createdAt,
  };
}

export function createWorkflowRepository(db: Database): WorkflowRepository {
  return {
    async createOrGetExecution(input: CreateExecutionInput) {
      const inserted = await db
        .insert(workflowExecutions)
        .values({
          familyId: input.familyId,
          userId: input.userId,
          workflowType: input.type,
          requestId: input.requestId,
          entityId: input.entityId ?? null,
          currentStage: input.initialStage,
          status: "queued",
          attempt: 0,
          input: input.input,
        })
        .onConflictDoNothing({
          target: [
            workflowExecutions.userId,
            workflowExecutions.requestId,
            workflowExecutions.workflowType,
          ],
        })
        .returning();

      if (inserted[0]) {
        return { execution: toExecution(inserted[0]), created: true };
      }

      // A concurrent duplicate won the insert — return the existing row.
      const [existing] = await db
        .select()
        .from(workflowExecutions)
        .where(
          and(
            eq(workflowExecutions.userId, input.userId),
            eq(workflowExecutions.requestId, input.requestId),
            eq(workflowExecutions.workflowType, input.type),
          ),
        )
        .limit(1);
      return { execution: toExecution(existing), created: false };
    },

    async getExecution(familyId, workflowId) {
      const [row] = await db
        .select()
        .from(workflowExecutions)
        .where(
          and(
            eq(workflowExecutions.id, workflowId),
            eq(workflowExecutions.familyId, familyId),
          ),
        )
        .limit(1);
      return row ? toExecution(row) : null;
    },

    async getExecutionById(workflowId) {
      const [row] = await db
        .select()
        .from(workflowExecutions)
        .where(eq(workflowExecutions.id, workflowId))
        .limit(1);
      return row ? toExecution(row) : null;
    },

    async findLatestByEntity(familyId, type, entityId) {
      const [row] = await db
        .select()
        .from(workflowExecutions)
        .where(
          and(
            eq(workflowExecutions.familyId, familyId),
            eq(workflowExecutions.workflowType, type),
            eq(workflowExecutions.entityId, entityId),
          ),
        )
        .orderBy(desc(workflowExecutions.createdAt))
        .limit(1);
      return row ? toExecution(row) : null;
    },

    async getStageOutput(workflowId, stageKey) {
      const [row] = await db
        .select()
        .from(workflowStageOutputs)
        .where(
          and(
            eq(workflowStageOutputs.workflowId, workflowId),
            eq(workflowStageOutputs.stageKey, stageKey),
          ),
        )
        .limit(1);
      return row ? toStageOutput(row) : null;
    },

    async listStageOutputs(workflowId) {
      const rows = await db
        .select()
        .from(workflowStageOutputs)
        .where(eq(workflowStageOutputs.workflowId, workflowId))
        .orderBy(workflowStageOutputs.createdAt);
      return rows.map(toStageOutput);
    },

    async claim(input: ClaimInput) {
      const now = input.now ?? new Date();
      const leaseExpiresAt = new Date(now.getTime() + input.leaseMs);
      // Claimable when: queued/waiting (no live lease), OR running with an
      // EXPIRED lease (visibility timeout — the previous drive crashed). A
      // running workflow with a live lease matches neither branch → null (locked).
      const rows = await db
        .update(workflowExecutions)
        .set({
          status: "running",
          leaseOwner: input.leaseOwner,
          leaseExpiresAt,
          startedAt: sql`coalesce(${workflowExecutions.startedAt}, ${now.toISOString()})`,
          updatedAt: now,
        })
        .where(
          and(
            eq(workflowExecutions.id, input.workflowId),
            or(
              inArray(workflowExecutions.status, ["queued", "waiting"]),
              and(
                eq(workflowExecutions.status, "running"),
                lt(workflowExecutions.leaseExpiresAt, now),
              ),
            ),
          ),
        )
        .returning();
      return rows[0] ? toExecution(rows[0]) : null;
    },

    async completeStage(input: CompleteStageInput) {
      const now = input.now ?? new Date();
      await db.transaction(async (tx) => {
        // Persist the stage output (idempotent — the unique anchor guards it) …
        await tx
          .insert(workflowStageOutputs)
          .values({
            workflowId: input.workflowId,
            stageKey: input.stageKey,
            output: input.output,
            attempt: input.attempt,
            promptVersion: input.lineage?.promptVersion ?? null,
            schemaVersion: input.lineage?.schemaVersion ?? null,
            modelRouteVersion: input.lineage?.modelRouteVersion ?? null,
            usage: input.lineage?.usage ?? null,
            latencyMs: input.lineage?.latencyMs ?? null,
          })
          .onConflictDoNothing({
            target: [
              workflowStageOutputs.workflowId,
              workflowStageOutputs.stageKey,
            ],
          });

        // … and advance the execution ATOMICALLY, but only if THIS drive still
        // holds the lease (a stolen lease means another drive owns the advance).
        await tx
          .update(workflowExecutions)
          .set({
            currentStage: input.nextStage,
            status: input.nextStatus,
            attempt: 0,
            leaseOwner: null,
            leaseExpiresAt: null,
            nextAttemptAt: null,
            lastError: null,
            ...(input.nextStatus === "completed" ? { completedAt: now } : {}),
            updatedAt: now,
          })
          .where(
            and(
              eq(workflowExecutions.id, input.workflowId),
              eq(workflowExecutions.leaseOwner, input.leaseOwner),
            ),
          );
      });
    },

    async advanceStage(input: AdvanceStageInput) {
      const now = input.now ?? new Date();
      await db
        .update(workflowExecutions)
        .set({
          currentStage: input.nextStage,
          status: input.nextStatus,
          attempt: 0,
          leaseOwner: null,
          leaseExpiresAt: null,
          nextAttemptAt: null,
          lastError: null,
          ...(input.nextStatus === "completed" ? { completedAt: now } : {}),
          updatedAt: now,
        })
        .where(
          and(
            eq(workflowExecutions.id, input.workflowId),
            eq(workflowExecutions.leaseOwner, input.leaseOwner),
          ),
        );
    },

    async recordRetry(input: RecordRetryInput) {
      const now = input.now ?? new Date();
      await db
        .update(workflowExecutions)
        .set({
          status: input.nextStatus,
          attempt: input.attempt,
          lastError: input.error,
          nextAttemptAt: input.nextAttemptAt,
          leaseOwner: null,
          leaseExpiresAt: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(workflowExecutions.id, input.workflowId),
            eq(workflowExecutions.leaseOwner, input.leaseOwner),
          ),
        );
    },

    async recordFailure(input: RecordFailureInput) {
      const now = input.now ?? new Date();
      // Dead-letter: mark failed with a SAFE error, keep currentStage so the
      // workflow stays resumable (`docs/05-backend/background-jobs.md`).
      await db
        .update(workflowExecutions)
        .set({
          status: input.nextStatus,
          attempt: input.attempt,
          lastError: input.error,
          leaseOwner: null,
          leaseExpiresAt: null,
          nextAttemptAt: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(workflowExecutions.id, input.workflowId),
            eq(workflowExecutions.leaseOwner, input.leaseOwner),
          ),
        );
    },

    async cancel(familyId, workflowId) {
      const now = new Date();
      const rows = await db
        .update(workflowExecutions)
        .set({
          status: "cancelled",
          leaseOwner: null,
          leaseExpiresAt: null,
          nextAttemptAt: null,
          completedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(workflowExecutions.id, workflowId),
            eq(workflowExecutions.familyId, familyId),
            // Cancel only where safe: queued or parked between stages.
            inArray(workflowExecutions.status, ["queued", "waiting"]),
          ),
        )
        .returning();
      return rows[0] ? toExecution(rows[0]) : null;
    },

    async requeue(familyId, workflowId) {
      const now = new Date();
      const rows = await db
        .update(workflowExecutions)
        .set({
          status: "queued",
          attempt: 0,
          lastError: null,
          nextAttemptAt: null,
          leaseOwner: null,
          leaseExpiresAt: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(workflowExecutions.id, workflowId),
            eq(workflowExecutions.familyId, familyId),
            // Only a dead-lettered workflow is re-queued.
            eq(workflowExecutions.status, "failed"),
          ),
        )
        .returning();
      return rows[0] ? toExecution(rows[0]) : null;
    },
  };
}

/** Convenience factory resolving the process database first (mirrors siblings). */
export async function getWorkflowRepository(): Promise<WorkflowRepository> {
  const { getDb } = await import("../client");
  return createWorkflowRepository(await getDb());
}
