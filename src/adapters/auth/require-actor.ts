import "server-only";

import { headers } from "next/headers";

import { getDb } from "@/db/client";
import { createFamilyRepository } from "@/db/repositories/family-repository";
import type { AuthenticatedActor, Role } from "@/domain/actor";
import { unauthorisedError } from "@/lib/errors";
import { getAuth } from "./auth";

/**
 * Resolve the current session and map it to the domain `AuthenticatedActor`
 * boundary (`docs/05-backend/auth.md`). Identity is always resolved
 * server-side from the HTTP-only session cookie.
 *
 * M2: `familyIds` and `roles` are now READ from `family_members` (the M1
 * placeholder that synthesised `["owner"]` / `[]` is gone). `familyIds` is the
 * distinct set of families the user belongs to; `roles` is the union of the
 * roles they hold across those families — the flat shape the fixed interface
 * requires. Per-family enforcement ("may this user do X in THIS family?") is
 * `authorizeFamilyAction` in the application layer, not this flat list.
 */
async function resolveActor(): Promise<AuthenticatedActor | null> {
  const auth = await getAuth();
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) return null;

  const repository = createFamilyRepository(await getDb());
  const memberships = await repository.listMembershipsForUser(session.user.id);

  const familyIds = [...new Set(memberships.map((m) => m.familyId))];
  const roles = [...new Set(memberships.map((m) => m.role))] as Role[];

  return {
    userId: session.user.id,
    familyIds,
    roles,
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
