import { z } from "zod";

import { DELETION_STEPS } from "@/domain/family-deletion";
import type { FamilyDeletionRepository } from "../ports/family-deletion-repository";
import type { ObjectStorage } from "../ports/object-storage";
import type {
  StageContext,
  StageResult,
  WorkflowDefinition,
} from "../workflow-engine";

/**
 * The FAMILY DELETION workflow (M10, `docs/05-backend/database.md` "Deletion",
 * `docs/05-backend/auth.md`). Owner-only, reauthenticated at the command boundary,
 * and driven as a DURABLE, IDEMPOTENT, RESUMABLE workflow so a crash mid-purge
 * resumes without duplicate work or lost audit:
 *
 *  1. `revoke-access`  — anonymise the family, stamp the tombstone, delete all
 *                        memberships (reader/delivery routes now 404).
 *  2. `purge-storage`  — read every private object key from the DB and delete it
 *                        from {@link ObjectStorage} (missing keys are a no-op, so a
 *                        resumed run re-deleting is harmless).
 *  3. `purge-database` — delete all family-scoped content + raw model outputs,
 *                        keeping ONLY this workflow's own execution row (the family
 *                        tombstone remains).
 *
 * Every step records a `family_deletion_audit` row (idempotent on (family, step)),
 * so the audit trail is complete even across resumes. Storage keys are collected
 * BEFORE the DB purge (the store has no list-by-prefix, so keys are read from the
 * rows the purge later removes).
 */

export const DELETE_FAMILY_TYPE = "delete-family";

export const DeleteFamilyInputSchema = z.object({
  /** The family to delete — must equal the workflow's own `familyId`. */
  familyId: z.string(),
});
export type DeleteFamilyInput = z.infer<typeof DeleteFamilyInputSchema>;

export interface DeleteFamilyDeps {
  familyDeletionRepository: FamilyDeletionRepository;
  objectStorage: ObjectStorage;
}

export function createDeleteFamilyWorkflow(
  deps: DeleteFamilyDeps,
): WorkflowDefinition<DeleteFamilyInput> {
  const { familyDeletionRepository: repo, objectStorage } = deps;

  return {
    type: DELETE_FAMILY_TYPE,
    capability: "family:delete",
    inputSchema: DeleteFamilyInputSchema,
    pendingLabel: "Removing this family's data",
    // Deletion is background/maintenance work; it must not preempt story
    // generation the family may still be reading (there is none after revoke,
    // but the priority is honest).
    dispatchPriority: "background",
    entityId: (input) => input.familyId,
    stages: [
      {
        key: DELETION_STEPS[0], // revoke-access
        label: "Revoking access",
        run: async (ctx: StageContext): Promise<StageResult> => {
          const familyId = ctx.execution.familyId;
          await repo.revokeAccess(familyId);
          await repo.recordStep({
            familyId,
            workflowId: ctx.execution.id,
            step: "revoke-access",
          });
          return { output: { revoked: true } };
        },
      },
      {
        key: DELETION_STEPS[1], // purge-storage
        label: "Deleting saved pictures",
        run: async (ctx: StageContext): Promise<StageResult> => {
          const familyId = ctx.execution.familyId;
          const keys = await repo.collectStorageKeys(familyId);
          for (const key of keys) {
            // Missing keys are a no-op, so re-running after a crash is safe.
            await objectStorage.delete(key);
          }
          await repo.recordStep({
            familyId,
            workflowId: ctx.execution.id,
            step: "purge-storage",
            detail: { keys: keys.length },
          });
          return { output: { deletedKeys: keys.length } };
        },
      },
      {
        key: DELETION_STEPS[2], // purge-database
        label: "Deleting stories and profiles",
        run: async (ctx: StageContext): Promise<StageResult> => {
          const familyId = ctx.execution.familyId;
          await repo.purgeContent(familyId, ctx.execution.id);
          await repo.recordStep({
            familyId,
            workflowId: ctx.execution.id,
            step: "purge-database",
          });
          return { output: { purged: true } };
        },
      },
    ],
  };
}
