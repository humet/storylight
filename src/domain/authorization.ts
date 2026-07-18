import type { Role } from "./actor";

/**
 * Role → capability policy (`docs/05-backend/auth.md` "Roles").
 *
 * Pure domain function: no IO, deterministic, exhaustively tested. Family
 * ownership/membership checks (does this actor belong to THIS family?) are a
 * separate concern layered on top in the application services once families
 * exist (M2); this module answers only "may a holder of these roles perform
 * this kind of action at all?".
 */
export type FamilyCapability =
  | "family:manage"
  | "family:delete"
  | "billing:manage"
  | "character:manage"
  | "safety:manage"
  | "story:create"
  | "story:edit"
  | "story:regenerate"
  | "story:read";

const OWNER_CAPABILITIES: readonly FamilyCapability[] = [
  "family:manage",
  "family:delete",
  "billing:manage",
  "character:manage",
  "safety:manage",
  "story:create",
  "story:edit",
  "story:regenerate",
  "story:read",
];

// Parent: create/edit stories, manage character profiles, regenerate content,
// change safety settings — but not manage or delete the family.
const PARENT_CAPABILITIES: readonly FamilyCapability[] = [
  "character:manage",
  "safety:manage",
  "story:create",
  "story:edit",
  "story:regenerate",
  "story:read",
];

// Viewer: read approved stories only.
const VIEWER_CAPABILITIES: readonly FamilyCapability[] = ["story:read"];

const ROLE_CAPABILITIES: Record<Role, ReadonlySet<FamilyCapability>> = {
  owner: new Set(OWNER_CAPABILITIES),
  parent: new Set(PARENT_CAPABILITIES),
  viewer: new Set(VIEWER_CAPABILITIES),
};

/** Whether a single role grants a capability. */
export function roleGrants(role: Role, capability: FamilyCapability): boolean {
  return ROLE_CAPABILITIES[role].has(capability);
}

/**
 * Whether an actor holding `roles` may perform `capability`. An actor is
 * permitted if ANY of their roles grants it (roles are additive).
 */
export function actorCan(
  roles: readonly Role[],
  capability: FamilyCapability,
): boolean {
  return roles.some((role) => roleGrants(role, capability));
}
