import { and, eq } from "drizzle-orm";

import type { FamilyRepository } from "@/application/ports/family-repository";
import type { Family, FamilyMembership } from "@/domain/family";
import type { Database } from "../client";
import { families, familyMembers, users } from "../schema";

/**
 * Drizzle implementation of the {@link FamilyRepository} port. This is the only
 * layer that knows the table shape; it maps rows to pure domain types so nothing
 * upstream depends on Drizzle (AGENTS.md: "Keep domain types independent of DB
 * row types").
 *
 * Every family-scoped read is filtered by BOTH `family_id` AND `user_id` against
 * `family_members`, so a caller who merely knows a family id — but is not a
 * member — gets nothing (`docs/05-backend/auth.md`).
 */

type FamilyRow = typeof families.$inferSelect;
type MembershipRow = typeof familyMembers.$inferSelect;

function toFamily(row: FamilyRow): Family {
  return { id: row.id, name: row.name };
}

function toMembership(row: MembershipRow): FamilyMembership {
  return { familyId: row.familyId, userId: row.userId, role: row.role };
}

export function createFamilyRepository(db: Database): FamilyRepository {
  return {
    async createFamilyWithOwner({ userId, familyName }) {
      return db.transaction(async (tx) => {
        const [family] = await tx
          .insert(families)
          .values({ name: familyName })
          .returning();

        const [membership] = await tx
          .insert(familyMembers)
          .values({ familyId: family.id, userId, role: "owner" })
          .returning();

        return {
          family: toFamily(family),
          membership: toMembership(membership),
        };
      });
    },

    async ensureFamilyForUser({ userId, familyName }) {
      return db.transaction(async (tx) => {
        // Lock the user row so concurrent reconciliations for the same user
        // serialize here — exactly one of them creates the family.
        await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, userId))
          .for("update");

        const existing = await tx
          .select()
          .from(familyMembers)
          .where(eq(familyMembers.userId, userId));
        if (existing.length > 0) return existing.map(toMembership);

        const [family] = await tx
          .insert(families)
          .values({ name: familyName })
          .returning();
        const [membership] = await tx
          .insert(familyMembers)
          .values({ familyId: family.id, userId, role: "owner" })
          .returning();
        return [toMembership(membership)];
      });
    },

    async listMembershipsForUser(userId) {
      const rows = await db
        .select()
        .from(familyMembers)
        .where(eq(familyMembers.userId, userId));
      return rows.map(toMembership);
    },

    async findMembership(familyId, userId) {
      const [row] = await db
        .select()
        .from(familyMembers)
        .where(
          and(
            eq(familyMembers.familyId, familyId),
            eq(familyMembers.userId, userId),
          ),
        )
        .limit(1);
      return row ? toMembership(row) : null;
    },

    async findFamilyForMember(familyId, userId) {
      const [row] = await db
        .select({ family: families })
        .from(families)
        .innerJoin(familyMembers, eq(familyMembers.familyId, families.id))
        .where(and(eq(families.id, familyId), eq(familyMembers.userId, userId)))
        .limit(1);
      return row ? toFamily(row.family) : null;
    },
  };
}

/**
 * Convenience factory that resolves the process database first. App code that
 * just needs "the" repository uses this; tests build one against a test database
 * with {@link createFamilyRepository} directly.
 */
export async function getFamilyRepository(): Promise<FamilyRepository> {
  const { getDb } = await import("../client");
  return createFamilyRepository(await getDb());
}
