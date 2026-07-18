import { actorCan, type FamilyCapability } from "@/domain/authorization";
import type { FamilyMembership } from "@/domain/family";
import { unauthorisedError } from "@/lib/errors";
import type { FamilyRepository } from "./ports/family-repository";

/**
 * The family authorisation surface. Every family-scoped command/query funnels
 * through here, combining the two independent checks
 * (`docs/05-backend/auth.md`):
 *
 *  1. MEMBERSHIP — is this user actually a member of THIS family? (Blocks
 *     cross-family access by ID guessing; a non-member gets `UNAUTHORISED`.)
 *  2. CAPABILITY — does the role they hold in that family grant the action?
 *     (e.g. a `viewer` may read but never mutate — pure policy from
 *     `src/domain/authorization.ts`.)
 *
 * Returns the verified membership so callers can reuse the resolved role. Throws
 * a client-safe `UNAUTHORISED` domain error otherwise — never leaking whether it
 * was membership or capability that failed.
 */
export async function authorizeFamilyAction(
  repo: FamilyRepository,
  input: { userId: string; familyId: string; capability: FamilyCapability },
): Promise<FamilyMembership> {
  const membership = await repo.findMembership(input.familyId, input.userId);

  if (!membership) {
    throw unauthorisedError({
      safeMessage: "You do not have access to this family.",
      internalDetail: `User ${input.userId} is not a member of family ${input.familyId}.`,
      stage: "authz.family-membership",
    });
  }

  if (!actorCan([membership.role], input.capability)) {
    throw unauthorisedError({
      safeMessage: "You do not have permission to do that.",
      internalDetail: `Role "${membership.role}" lacks capability "${input.capability}".`,
      stage: "authz.family-capability",
    });
  }

  return membership;
}
