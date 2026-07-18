"use server";

import { requireActor } from "@/adapters/auth/require-actor";
import { getWorkflowService } from "@/adapters/jobs";
import { toClientError, type ClientError } from "@/lib/errors";

/**
 * Safe-retry Server Action for a failed series workflow (create-series or
 * generate-next-chapter). Re-queues the dead-lettered workflow by id and re-drives
 * it; the engine resumes from durable stages, so completed work is not repeated.
 * Only offered for non-safety failures — a safety block is terminal.
 */

export type RetrySeriesResult =
  { ok: true; workflowId: string } | { ok: false; error: ClientError };

export async function retrySeriesAction(
  workflowId: string,
): Promise<RetrySeriesResult> {
  try {
    const actor = await requireActor();
    const service = await getWorkflowService();
    const resumed = await service.resumeWorkflow(actor, workflowId);
    if (!resumed) {
      return {
        ok: false,
        error: {
          code: "INVALID_COMMAND",
          message: "That series task could not be found.",
          correlationId: "",
        },
      };
    }
    return { ok: true, workflowId: resumed.id };
  } catch (error) {
    return { ok: false, error: toClientError(error) };
  }
}
