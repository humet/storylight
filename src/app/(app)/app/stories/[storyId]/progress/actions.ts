"use server";

import { requireActor } from "@/adapters/auth/require-actor";
import { getWorkflowService } from "@/adapters/jobs";
import { CREATE_ONE_OFF_STORY_TYPE } from "@/application/workflows/create-one-off-story-workflow";
import { toClientError, type ClientError } from "@/lib/errors";

/**
 * Safe-retry Server Action for a failed story workflow (`docs/04-frontend/mobile-ux.md`
 * "Progress": safe retry on failure). Re-queues the dead-lettered workflow and
 * re-drives it; the engine resumes from durable stages, so completed work is not
 * repeated. Only offered for non-safety failures — a safety block is terminal.
 */

export type RetryStoryResult =
  { ok: true; workflowId: string } | { ok: false; error: ClientError };

export async function retryStoryAction(
  storyId: string,
): Promise<RetryStoryResult> {
  try {
    const actor = await requireActor();
    const service = await getWorkflowService();
    const latest = await service.getLatestWorkflowForEntity(
      actor,
      CREATE_ONE_OFF_STORY_TYPE,
      storyId,
    );
    if (!latest) {
      return {
        ok: false,
        error: {
          code: "INVALID_COMMAND",
          message: "That story could not be found.",
          correlationId: "",
        },
      };
    }
    const resumed = await service.resumeWorkflow(actor, latest.id);
    return { ok: true, workflowId: resumed?.id ?? latest.id };
  } catch (error) {
    return { ok: false, error: toClientError(error) };
  }
}
