"use server";

import { requireActor } from "@/adapters/auth/require-actor";
import { toClientError, type ClientError } from "@/lib/errors";
import { getStoryServices } from "../../stories/service";

/**
 * Thin Server Action for parent safety settings (`docs/05-backend/api.md`
 * "Server Actions": updateStoryPreferences). Resolves the actor and delegates to
 * the command service, which authorises `safety:manage` and validates with Zod.
 */

export type UpdateSettingsResult =
  { ok: true } | { ok: false; error: ClientError };

export async function updateStoryPreferencesAction(
  input: unknown,
): Promise<UpdateSettingsResult> {
  try {
    const actor = await requireActor();
    const { commands } = await getStoryServices();
    await commands.updateStoryPreferences(actor, input);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toClientError(error) };
  }
}
