"use server";

import { requireActor } from "@/adapters/auth/require-actor";
import { toClientError, type ClientError } from "@/lib/errors";
import { getStoryServices } from "../stories/service";

/**
 * Thin Server Action for the create flow (`docs/05-backend/api.md` "Server
 * Actions"): resolve the actor, call the command service (which authorises,
 * validates, creates the story row, and starts the durable workflow), and return
 * a client-safe result the wizard branches on. No orchestration lives here.
 */

export type CreateOneOffStoryResult =
  | { ok: true; storyId: string; workflowId: string }
  | { ok: false; error: ClientError };

export async function createOneOffStoryAction(
  input: unknown,
): Promise<CreateOneOffStoryResult> {
  try {
    const actor = await requireActor();
    const { commands } = await getStoryServices();
    const result = await commands.createOneOffStory(actor, input);
    return { ok: true, storyId: result.storyId, workflowId: result.workflowId };
  } catch (error) {
    return { ok: false, error: toClientError(error) };
  }
}
