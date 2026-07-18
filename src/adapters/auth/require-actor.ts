import "server-only";

import { headers } from "next/headers";

import type { AuthenticatedActor } from "@/domain/actor";
import { unauthorisedError } from "@/lib/errors";
import { getAuth } from "./auth";

/**
 * Resolve the current session and map it to the domain `AuthenticatedActor`
 * boundary (`docs/05-backend/auth.md`). Identity is always resolved
 * server-side from the HTTP-only session cookie.
 *
 * M1 mapping note: role and family membership are not persisted until M2, so a
 * signed-in user is treated as the `owner` of their (future) family with an
 * empty `familyIds`. When the Drizzle-backed membership tables land in M2 this
 * mapping reads real rows; the return TYPE does not change.
 */
async function resolveActor(): Promise<AuthenticatedActor | null> {
  const session = await getAuth().api.getSession({
    headers: await headers(),
  });

  if (!session?.user) return null;

  return {
    userId: session.user.id,
    familyIds: [],
    roles: ["owner"],
  };
}

/**
 * Return the authenticated actor, or `null` when there is no valid session.
 * Use this where the caller wants to branch on auth (e.g. a page that redirects
 * unauthenticated visitors).
 */
export async function getOptionalActor(): Promise<AuthenticatedActor | null> {
  return resolveActor();
}

/**
 * Return the authenticated actor or throw a typed `UNAUTHORISED` domain error.
 * Use this in Server Actions and Route Handlers so the safe error contract
 * (`docs/05-backend/api.md`) is preserved. Pages that prefer a redirect should
 * catch this and `redirect()`, or use {@link getOptionalActor}.
 */
export async function requireActor(): Promise<AuthenticatedActor> {
  const actor = await resolveActor();
  if (!actor) {
    throw unauthorisedError({
      internalDetail: "No valid session cookie on the incoming request.",
    });
  }
  return actor;
}
