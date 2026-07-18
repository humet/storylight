import type { AuthenticatedActor } from "@/domain/actor";
import { isTerminalStatus } from "@/domain/workflow";
import type {
  WorkflowExecution,
  WorkflowHandle,
  WorkflowStatus,
} from "@/domain/workflow";
import { invalidCommandError, unauthorisedError } from "@/lib/errors";
import type { SafeErrorCode } from "@/lib/errors";
import { authorizeFamilyAction } from "./family-access";
import type { JobDispatcher } from "./ports/job-dispatcher";
import type { FamilyRepository } from "./ports/family-repository";
import type { WorkflowRepository } from "./ports/workflow-repository";
import type { WorkflowRegistry } from "./workflow-engine";

/**
 * The command/query surface over the workflow engine (`docs/05-backend/api.md`).
 * It is the ONLY way the rest of the app starts, cancels, or inspects a
 * workflow, and it always:
 *
 *  1. resolves the actor's family and AUTHORISES the capability the workflow
 *     definition declares (never trusting an id);
 *  2. validates input with the definition's Zod schema at the boundary;
 *  3. delegates durable execution to the {@link JobDispatcher} and canonical
 *     state to the {@link WorkflowRepository} — never to a provider SDK.
 *
 * Idempotent creation is enforced by the DB `UNIQUE(user_id, request_id,
 * workflow_type)` constraint, so a duplicate submission returns the EXISTING
 * handle instead of doing the work twice (`docs/02-storytelling/story-engine.md`:
 * "Duplicate commands return the existing workflow").
 */

export interface WorkflowServiceDeps {
  familyRepository: FamilyRepository;
  workflowRepository: WorkflowRepository;
  registry: WorkflowRegistry;
  dispatcher: JobDispatcher;
}

/** Client-safe view of a workflow's progress (`docs/05-backend/api.md`). */
export interface WorkflowStatusView {
  id: string;
  type: string;
  status: WorkflowStatus;
  /** Parent-friendly progress copy — NEVER a raw stage key, prompt, or provider error. */
  label: string;
  isTerminal: boolean;
  isComplete: boolean;
  isFailed: boolean;
  /** Safe error code + calm message when failed; otherwise null. */
  error: { code: SafeErrorCode; message: string } | null;
}

function requirePrimaryFamily(actor: AuthenticatedActor): string {
  const familyId = actor.familyIds[0];
  if (!familyId) {
    throw unauthorisedError({
      internalDetail: `Actor ${actor.userId} has no family to act in.`,
      stage: "workflow.family",
    });
  }
  return familyId;
}

export function createWorkflowService(deps: WorkflowServiceDeps) {
  const { familyRepository, workflowRepository, registry, dispatcher } = deps;

  function definitionFor(type: string) {
    const def = registry[type];
    if (!def) {
      throw invalidCommandError({
        safeMessage: "This kind of task is not available.",
        internalDetail: `No workflow definition registered for type "${type}".`,
        stage: "workflow.start",
      });
    }
    return def;
  }

  /**
   * Map an execution to the client-safe view. Loading copy comes from the stage
   * label (`docs/company/writing-style.md`); internal stage keys and raw errors
   * never leak.
   */
  function toStatusView(execution: WorkflowExecution): WorkflowStatusView {
    const def = registry[execution.type];
    const stage = def?.stages.find((s) => s.key === execution.currentStage);
    const isFailed = execution.status === "failed";
    const isComplete = execution.status === "completed";

    let label: string;
    if (isComplete) label = "All done";
    else if (isFailed)
      label =
        execution.lastError?.message ??
        "This did not come together. You can try again.";
    else if (execution.status === "cancelled") label = "Stopped";
    else label = stage?.label ?? def?.pendingLabel ?? "Working on it";

    return {
      id: execution.id,
      type: execution.type,
      status: execution.status,
      label,
      isTerminal: isTerminalStatus(execution.status),
      isComplete,
      isFailed,
      error:
        isFailed && execution.lastError
          ? {
              code: execution.lastError.code,
              message: execution.lastError.message,
            }
          : null,
    };
  }

  return {
    /**
     * Start (or resolve the existing) workflow for `type` with a stable
     * `requestId`. Authorises + validates, creates the row idempotently, then
     * dispatches durable compute. Re-dispatching an existing run is safe (the
     * engine skips already-persisted stages), so a duplicate submission returns
     * the existing handle and never duplicates provider work.
     */
    async startWorkflow(
      actor: AuthenticatedActor,
      type: string,
      requestId: string,
      rawInput: unknown,
    ): Promise<WorkflowHandle> {
      const def = definitionFor(type);
      const familyId = requirePrimaryFamily(actor);
      await authorizeFamilyAction(familyRepository, {
        userId: actor.userId,
        familyId,
        capability: def.capability,
      });
      const input = def.inputSchema.parse(rawInput);
      const entityId = def.entityId?.(input);

      const { execution, created } =
        await workflowRepository.createOrGetExecution({
          familyId,
          userId: actor.userId,
          type,
          requestId,
          entityId,
          input,
          initialStage: def.stages[0].key,
        });

      // Dispatch on first creation. (A duplicate submission of an in-flight run
      // does not need another dispatch; a resumed/failed run is re-driven via
      // resumeWorkflow.)
      if (created)
        await dispatcher.dispatch(execution.id, {
          priority: def.dispatchPriority,
        });

      return {
        workflowId: execution.id,
        status: execution.status,
        created,
      };
    },

    /** Client-safe progress for one workflow (family-scoped). Null if not found. */
    async getWorkflowStatus(
      actor: AuthenticatedActor,
      workflowId: string,
    ): Promise<WorkflowStatusView | null> {
      const familyId = requirePrimaryFamily(actor);
      await authorizeFamilyAction(familyRepository, {
        userId: actor.userId,
        familyId,
        capability: "story:read",
      });
      const execution = await workflowRepository.getExecution(
        familyId,
        workflowId,
      );
      return execution ? toStatusView(execution) : null;
    },

    /**
     * The latest workflow of `type` acting on `entityId` in the actor's family,
     * as a client-safe view (used to detect an in-flight candidate generation).
     */
    async getLatestWorkflowForEntity(
      actor: AuthenticatedActor,
      type: string,
      entityId: string,
    ): Promise<WorkflowStatusView | null> {
      const familyId = requirePrimaryFamily(actor);
      await authorizeFamilyAction(familyRepository, {
        userId: actor.userId,
        familyId,
        capability: "story:read",
      });
      const execution = await workflowRepository.findLatestByEntity(
        familyId,
        type,
        entityId,
      );
      return execution ? toStatusView(execution) : null;
    },

    /** Cancel a workflow where safe (queued/waiting). Returns the new view or null. */
    async cancelWorkflow(
      actor: AuthenticatedActor,
      workflowId: string,
    ): Promise<WorkflowStatusView | null> {
      const familyId = requirePrimaryFamily(actor);
      const def = await workflowRepository.getExecution(familyId, workflowId);
      // Authorise with the workflow's own capability (the mutator of the task).
      await authorizeFamilyAction(familyRepository, {
        userId: actor.userId,
        familyId,
        capability: def ? definitionFor(def.type).capability : "story:create",
      });
      const cancelled = await workflowRepository.cancel(familyId, workflowId);
      return cancelled ? toStatusView(cancelled) : null;
    },

    /**
     * Re-drive a dead-lettered (`failed`) workflow: re-queue it, then dispatch
     * fresh durable compute. The engine resumes from the durable stage — already
     * persisted stages are skipped, so no completed work repeats.
     */
    async resumeWorkflow(
      actor: AuthenticatedActor,
      workflowId: string,
    ): Promise<WorkflowStatusView | null> {
      const familyId = requirePrimaryFamily(actor);
      const existing = await workflowRepository.getExecution(
        familyId,
        workflowId,
      );
      if (!existing) return null;
      await authorizeFamilyAction(familyRepository, {
        userId: actor.userId,
        familyId,
        capability: definitionFor(existing.type).capability,
      });
      const requeued = await workflowRepository.requeue(familyId, workflowId);
      if (!requeued) return null;
      await dispatcher.dispatch(requeued.id, {
        priority: definitionFor(existing.type).dispatchPriority,
      });
      return toStatusView(requeued);
    },
  };
}

export type WorkflowService = ReturnType<typeof createWorkflowService>;
