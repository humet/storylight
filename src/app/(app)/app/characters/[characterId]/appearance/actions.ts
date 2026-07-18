"use server";

import { redirect } from "next/navigation";

import { requireActor } from "@/adapters/auth/require-actor";
import { getWorkflowService } from "@/adapters/jobs";
import { GENERATE_CHARACTER_CANDIDATES_TYPE } from "@/application/workflows/generate-character-candidates-workflow";
import { getVisualCharacterService } from "../../visual-service";

/**
 * Thin Server Action adapters for the appearance surface. Each resolves the
 * actor, calls the relevant service (which authorises + validates), then
 * redirects back to the appearance page so the freshly-changed state renders.
 * No orchestration lives here.
 *
 * `requestCandidates` now STARTS a durable `generate-character-candidates`
 * workflow (M5) instead of generating inline — the engine owns idempotency,
 * retries, and resume, and the page polls progress. Approve/reject stay
 * synchronous (they are quick, transactional canonical writes).
 */

function appearancePath(characterId: string): string {
  return `/app/characters/${characterId}/appearance`;
}

export async function requestCandidatesAction(
  formData: FormData,
): Promise<void> {
  const characterId = String(formData.get("characterId"));
  const actor = await requireActor();
  const workflows = await getWorkflowService();
  // A fresh request id per click: each "paint" is a distinct intent (idempotency
  // still dedupes an accidental double-submit of the same request id).
  await workflows.startWorkflow(
    actor,
    GENERATE_CHARACTER_CANDIDATES_TYPE,
    globalThis.crypto.randomUUID(),
    { characterId },
  );
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
