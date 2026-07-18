"use server";

import { z } from "zod";

import { reauthenticateCurrentUser } from "@/adapters/auth/passwords";
import { requireActor } from "@/adapters/auth/require-actor";
import { getWorkflowService } from "@/adapters/jobs";
import { DELETE_FAMILY_TYPE } from "@/application/workflows/delete-family-workflow";
import {
  invalidCommandError,
  toClientError,
  type ClientError,
} from "@/lib/errors";

/**
 * DANGER-ZONE Server Action: request FAMILY DELETION (`docs/05-backend/auth.md`
 * "Destructive actions require appropriate role and confirmation";
 * `docs/05-backend/database.md` "Deletion"). It:
 *
 *  1. resolves the actor (session identity);
 *  2. REAUTHENTICATES by verifying the current password (a fresh confirmation for
 *     a destructive action, per auth.md — never a security boundary stronger than
 *     the session, just a deliberate gate);
 *  3. starts the owner-only `delete-family` workflow. The workflow service
 *     authorises the `family:delete` capability (owner-only) before dispatching,
 *     so a non-owner is rejected there.
 *
 * The heavy, auditable purge runs durably in the background; the action returns as
 * soon as the workflow is queued.
 */

export type DeleteFamilyResult =
  { ok: true; workflowId: string } | { ok: false; error: ClientError };

const InputSchema = z.object({
  password: z.string().min(1),
  /** The user must type the confirmation phrase to proceed. */
  confirm: z.literal("DELETE"),
});

export async function requestFamilyDeletionAction(
  input: unknown,
): Promise<DeleteFamilyResult> {
  try {
    const parsed = InputSchema.safeParse(input);
    if (!parsed.success) {
      throw invalidCommandError({
        safeMessage: "Type DELETE and your password to confirm.",
        internalDetail: "Family-deletion confirmation failed validation.",
        stage: "family.delete",
      });
    }
    const actor = await requireActor();
    // Reauthenticate (verify the current password) BEFORE anything destructive.
    await reauthenticateCurrentUser(parsed.data.password);

    const familyId = actor.familyIds[0];
    if (!familyId) {
      throw invalidCommandError({
        safeMessage: "There is no family to delete.",
        internalDetail: `Actor ${actor.userId} has no family.`,
        stage: "family.delete",
      });
    }

    const service = await getWorkflowService();
    // A stable request id so a double submit resolves to ONE deletion workflow.
    const handle = await service.startWorkflow(
      actor,
      DELETE_FAMILY_TYPE,
      `delete-family:${familyId}`,
      { familyId },
    );
    return { ok: true, workflowId: handle.workflowId };
  } catch (error) {
    return { ok: false, error: toClientError(error) };
  }
}
