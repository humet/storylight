import "server-only";

import { redirect } from "next/navigation";

import { requireActor } from "@/adapters/auth/require-actor";
import type { AuthenticatedActor } from "@/domain/actor";
import { isDomainError } from "@/lib/errors";

/**
 * Resolve the authenticated actor for an app page, sending unauthenticated
 * visitors to sign-in (the app-shell policy). Any non-auth failure is a real
 * error and rethrown. `redirect()` throws its control-flow signal from the catch,
 * which propagates out uncaught — exactly what we want. Shared by the story
 * surfaces (mirrors the character editor's guard).
 */
export async function actorOrRedirect(): Promise<AuthenticatedActor> {
  try {
    return await requireActor();
  } catch (error) {
    if (isDomainError(error) && error.code === "UNAUTHORISED") {
      redirect("/sign-in");
    }
    throw error;
  }
}
