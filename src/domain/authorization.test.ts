import { describe, expect, it } from "vitest";
import type { Role } from "./actor";
import { actorCan, roleGrants, type FamilyCapability } from "./authorization";

describe("role authorization policy", () => {
  it("grants the owner every capability", () => {
    const capabilities: FamilyCapability[] = [
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
    for (const capability of capabilities) {
      expect(roleGrants("owner", capability)).toBe(true);
    }
  });

  it("lets a parent create stories and manage characters but not the family", () => {
    expect(roleGrants("parent", "story:create")).toBe(true);
    expect(roleGrants("parent", "character:manage")).toBe(true);
    expect(roleGrants("parent", "safety:manage")).toBe(true);
    expect(roleGrants("parent", "family:manage")).toBe(false);
    expect(roleGrants("parent", "family:delete")).toBe(false);
    expect(roleGrants("parent", "billing:manage")).toBe(false);
  });

  it("restricts a viewer to reading approved stories", () => {
    expect(roleGrants("viewer", "story:read")).toBe(true);
    expect(roleGrants("viewer", "story:create")).toBe(false);
    expect(roleGrants("viewer", "character:manage")).toBe(false);
  });

  it("treats an actor's roles additively", () => {
    const roles: Role[] = ["viewer", "parent"];
    // Reachable via parent even though viewer alone cannot.
    expect(actorCan(roles, "story:create")).toBe(true);
    // No role grants family management.
    expect(actorCan(roles, "family:manage")).toBe(false);
  });

  it("denies everything to an actor with no roles", () => {
    expect(actorCan([], "story:read")).toBe(false);
  });
});
