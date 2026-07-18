"use server";

import { redirect } from "next/navigation";

import { requireActor } from "@/adapters/auth/require-actor";
import { getVisualCharacterService } from "../../visual-service";

/**
 * Thin Server Action adapters for the appearance surface. Each resolves the
 * actor, calls the visual-character service (which authorises + validates), then
 * redirects back to the appearance page so the freshly-changed state renders.
 * No orchestration lives here.
 *
 * `requestCandidates` runs candidate generation synchronously (the fake image
 * adapter is fast in M4); M5 will move it onto the durable JobDispatcher without
 * changing this action's contract.
 */

function appearancePath(characterId: string): string {
  return `/app/characters/${characterId}/appearance`;
}

export async function requestCandidatesAction(
  formData: FormData,
): Promise<void> {
  const characterId = String(formData.get("characterId"));
  const actor = await requireActor();
  const service = await getVisualCharacterService();
  await service.requestCandidateSets(actor, { characterId });
  redirect(appearancePath(characterId));
}

export async function approveCandidateSetAction(
  formData: FormData,
): Promise<void> {
  const characterId = String(formData.get("characterId"));
  const actor = await requireActor();
  const service = await getVisualCharacterService();
  await service.approveCandidateSet(actor, {
    characterId,
    candidateSetId: formData.get("candidateSetId"),
  });
  redirect(appearancePath(characterId));
}

export async function rejectCandidateSetAction(
  formData: FormData,
): Promise<void> {
  const characterId = String(formData.get("characterId"));
  const actor = await requireActor();
  const service = await getVisualCharacterService();
  await service.rejectCandidateSet(actor, {
    characterId,
    candidateSetId: formData.get("candidateSetId"),
  });
  redirect(appearancePath(characterId));
}
