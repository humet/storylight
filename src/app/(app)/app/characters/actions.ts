"use server";

import { redirect } from "next/navigation";

import { requireActor } from "@/adapters/auth/require-actor";
import { toClientError, type ClientError } from "@/lib/errors";
import { getCharacterServices } from "./service";

/**
 * Thin Server Action adapters for the character editor (`docs/05-backend/api.md`
 * "Server Actions"): resolve the actor, call the application service, and either
 * return a client-safe result or redirect. No orchestration lives here — the
 * command service authorises and validates.
 *
 * Create/update return a discriminated result the client wizard branches on;
 * approve/retire are progressive-enhancement `<form>` actions that redirect.
 */

export type CreateCharacterResult =
  { ok: true; id: string } | { ok: false; error: ClientError };

export async function createCharacterProfileAction(
  input: unknown,
): Promise<CreateCharacterResult> {
  try {
    const actor = await requireActor();
    const { commands } = await getCharacterServices();
    const profile = await commands.createCharacterProfile(actor, input);
    return { ok: true, id: profile.id };
  } catch (error) {
    return { ok: false, error: toClientError(error) };
  }
}

export async function updateCharacterProfileAction(
  input: unknown,
): Promise<CreateCharacterResult> {
  try {
    const actor = await requireActor();
    const { commands } = await getCharacterServices();
    const profile = await commands.updateCharacterProfile(actor, input);
    return { ok: true, id: profile.id };
  } catch (error) {
    return { ok: false, error: toClientError(error) };
  }
}

export async function approveCharacterProfileAction(
  formData: FormData,
): Promise<void> {
  const actor = await requireActor();
  const { commands } = await getCharacterServices();
  await commands.approveCharacterProfile(actor, {
    characterId: formData.get("characterId"),
  });
  redirect("/app/characters");
}

export async function retireCharacterProfileAction(
  formData: FormData,
): Promise<void> {
  const actor = await requireActor();
  const { commands } = await getCharacterServices();
  await commands.retireCharacterProfile(actor, {
    characterId: formData.get("characterId"),
  });
  redirect("/app/characters");
}
