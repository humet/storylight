import type { Role } from "./actor";

/**
 * Family domain types (`docs/05-backend/auth.md`, `docs/05-backend/database.md`).
 *
 * These are pure domain shapes, deliberately INDEPENDENT of Drizzle row types
 * (AGENTS.md: "Keep domain types independent of DB row types"). The database
 * repository maps rows to these; nothing in the domain or application layer
 * imports a table's inferred type.
 */

/** A family — the tenancy boundary that owns every story, character and asset. */
export interface Family {
  id: string;
  name: string;
}

/** A user's membership of one family, carrying the role they hold there. */
export interface FamilyMembership {
  familyId: string;
  userId: string;
  role: Role;
}
