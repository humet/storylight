import { beforeEach, afterEach, describe, expect, it } from "vitest";

import { authorizeFamilyAction } from "@/application/family-access";
import type { FamilyRepository } from "@/application/ports/family-repository";
import { isDomainError } from "@/lib/errors";
import type { Database } from "./client";
import { createFamilyRepository } from "./repositories/family-repository";
import { familyMembers, users } from "./schema";
import { createTestDatabase, type TestDatabase } from "./testing";

/**
 * Milestone 2 centerpiece (`docs/IMPLEMENTATION_PLAN.md`, `docs/05-backend/auth.md`):
 * "a signed-in parent can access only their own family". Every test runs
 * migrations from an EMPTY PGlite (via `createTestDatabase`) and then exercises
 * the real repository + authorisation service — no mocks — proving:
 *
 *  - a user cannot read or act on another family's data by guessing its ID; and
 *  - role capabilities are enforced (a viewer cannot mutate).
 */

let harness: TestDatabase;
let db: Database;
let repo: FamilyRepository;

/** Insert a Better Auth user row directly (the auth adapter does this in prod). */
async function seedUser(id: string): Promise<string> {
  await db.insert(users).values({
    id,
    name: `User ${id}`,
    email: `${id}@example.test`,
    emailVerified: true,
  });
  return id;
}

beforeEach(async () => {
  harness = await createTestDatabase();
  db = harness.db;
  repo = createFamilyRepository(db);
});

afterEach(async () => {
  await harness.close();
});

describe("family bootstrap", () => {
  it("creates a family and an owner membership atomically", async () => {
    const userId = await seedUser("owner-1");

    const { family, membership } = await repo.createFamilyWithOwner({
      userId,
      familyName: "The Testers",
    });

    expect(family.name).toBe("The Testers");
    expect(membership).toEqual({
      familyId: family.id,
      userId,
      role: "owner",
    });

    const memberships = await repo.listMembershipsForUser(userId);
    expect(memberships).toEqual([membership]);
  });
});

describe("cross-family isolation", () => {
  it("does not return another family's data by ID", async () => {
    const alice = await seedUser("alice");
    const bob = await seedUser("bob");
    const { family: familyA } = await repo.createFamilyWithOwner({
      userId: alice,
      familyName: "Alice family",
    });
    const { family: familyB } = await repo.createFamilyWithOwner({
      userId: bob,
      familyName: "Bob family",
    });

    // Alice can read her own family.
    await expect(repo.findFamilyForMember(familyA.id, alice)).resolves.toEqual(
      familyA,
    );

    // Alice cannot read Bob's family even though she knows its ID.
    await expect(
      repo.findFamilyForMember(familyB.id, alice),
    ).resolves.toBeNull();
    await expect(repo.findMembership(familyB.id, alice)).resolves.toBeNull();
  });

  it("blocks an outsider from acting on a family they do not belong to", async () => {
    const alice = await seedUser("alice");
    const bob = await seedUser("bob");
    await repo.createFamilyWithOwner({
      userId: alice,
      familyName: "Alice family",
    });
    const { family: familyB } = await repo.createFamilyWithOwner({
      userId: bob,
      familyName: "Bob family",
    });

    await expect(
      authorizeFamilyAction(repo, {
        userId: alice,
        familyId: familyB.id,
        capability: "story:read",
      }),
    ).rejects.toSatisfy(
      (error: unknown) => isDomainError(error) && error.code === "UNAUTHORISED",
    );
  });
});

describe("role capabilities within a family", () => {
  it("lets an owner create stories but a viewer only read", async () => {
    const owner = await seedUser("owner");
    const viewer = await seedUser("viewer");
    const { family } = await repo.createFamilyWithOwner({
      userId: owner,
      familyName: "Shared family",
    });

    // Add the viewer to the SAME family with the viewer role.
    await db.insert(familyMembers).values({
      familyId: family.id,
      userId: viewer,
      role: "viewer",
    });

    // Owner may create.
    await expect(
      authorizeFamilyAction(repo, {
        userId: owner,
        familyId: family.id,
        capability: "story:create",
      }),
    ).resolves.toMatchObject({ role: "owner" });

    // Viewer may read.
    await expect(
      authorizeFamilyAction(repo, {
        userId: viewer,
        familyId: family.id,
        capability: "story:read",
      }),
    ).resolves.toMatchObject({ role: "viewer" });

    // Viewer may NOT create — role lacks the capability even though membership
    // is valid.
    await expect(
      authorizeFamilyAction(repo, {
        userId: viewer,
        familyId: family.id,
        capability: "story:create",
      }),
    ).rejects.toSatisfy(
      (error: unknown) => isDomainError(error) && error.code === "UNAUTHORISED",
    );
  });
});

describe("ensureFamilyForUser (orphaned-account reconciliation)", () => {
  it("creates a family + owner membership for a user with none", async () => {
    const userId = await seedUser("orphan-1");

    const memberships = await repo.ensureFamilyForUser({
      userId,
      familyName: "Healed family",
    });

    expect(memberships).toHaveLength(1);
    expect(memberships[0]).toMatchObject({ userId, role: "owner" });
  });

  it("is idempotent: existing memberships are returned unchanged", async () => {
    const userId = await seedUser("orphan-2");
    const { family } = await repo.createFamilyWithOwner({
      userId,
      familyName: "Original family",
    });

    const memberships = await repo.ensureFamilyForUser({
      userId,
      familyName: "Should not be created",
    });

    expect(memberships).toHaveLength(1);
    expect(memberships[0].familyId).toBe(family.id);
    const allFamilies = await db.query.families.findMany();
    expect(allFamilies).toHaveLength(1);
  });

  it("creates exactly one family under concurrent reconciliation", async () => {
    const userId = await seedUser("orphan-3");

    const results = await Promise.all([
      repo.ensureFamilyForUser({ userId, familyName: "Race A" }),
      repo.ensureFamilyForUser({ userId, familyName: "Race B" }),
      repo.ensureFamilyForUser({ userId, familyName: "Race C" }),
    ]);

    const familyIds = new Set(
      results.flat().map((membership) => membership.familyId),
    );
    expect(familyIds.size).toBe(1);
    const rows = await db.select().from(familyMembers);
    expect(rows).toHaveLength(1);
  });
});
