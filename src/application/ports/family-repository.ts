import type { Family, FamilyMembership } from "@/domain/family";

/**
 * Family/membership repository PORT — owned by the application layer, so policy
 * never depends on Drizzle. The Drizzle implementation lives in
 * `src/db/repositories/family-repository.ts`; tests can supply a fake.
 *
 * Authorisation principle baked into the shape (`docs/05-backend/auth.md`:
 * "never authorise by mere possession of an ID"): every read that returns
 * family-scoped data takes BOTH the family id and the requesting user id, and
 * returns data only when a membership row proves the user belongs to that
 * family. There is deliberately no `findFamilyById(id)` that trusts an ID alone.
 */
export interface FamilyRepository {
  /**
   * Create a family and its owner membership in ONE transaction. Used to
   * bootstrap a family on sign-up so every user has at least one family.
   */
  createFamilyWithOwner(input: {
    userId: string;
    familyName: string;
  }): Promise<{ family: Family; membership: FamilyMembership }>;

  /** Every membership the user holds (used to resolve the authenticated actor). */
  listMembershipsForUser(userId: string): Promise<FamilyMembership[]>;

  /**
   * Idempotent reconciliation guaranteeing the "every user has ≥1 family"
   * invariant: if the user already has memberships they are returned unchanged;
   * if they have none (e.g. the best-effort sign-up bootstrap failed), a family
   * + owner membership is created. Safe under concurrent calls — the
   * implementation must serialize per user so exactly one family is created.
   */
  ensureFamilyForUser(input: {
    userId: string;
    familyName: string;
  }): Promise<FamilyMembership[]>;

  /**
   * The user's membership of a specific family, or `null` if they are not a
   * member. This is the authorisation primitive: a `null` result means the
   * caller must be treated as an outsider to that family.
   */
  findMembership(
    familyId: string,
    userId: string,
  ): Promise<FamilyMembership | null>;

  /**
   * The family — but only when `userId` is a member of it. Returns `null` both
   * when the family does not exist and when the user is not a member, so an
   * outsider cannot even distinguish the two by ID.
   */
  findFamilyForMember(familyId: string, userId: string): Promise<Family | null>;
}
