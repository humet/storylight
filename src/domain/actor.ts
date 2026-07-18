/**
 * The authenticated actor boundary.
 *
 * This is the ONLY identity shape domain and application code may depend on
 * (`docs/05-backend/auth.md`). The auth provider (Better Auth today) is mapped
 * to this type inside `src/adapters/auth/`; nothing outside that adapter may
 * import provider types. Keeping the interface here — in pure domain code with
 * no IO — is what lets the provider be swapped without touching policy.
 */

export type Role = "owner" | "parent" | "viewer";

export interface AuthenticatedActor {
  userId: string;
  familyIds: string[];
  /**
   * ⚠️ Union of the roles the user holds across ALL their families (the shape
   * `docs/05-backend/auth.md` fixes). Never authorize a family-scoped action
   * from this flat list — a role held in family A must not grant anything in
   * family B. Use `authorizeFamilyAction` for per-family decisions.
   */
  roles: Role[];
}
