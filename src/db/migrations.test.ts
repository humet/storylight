import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createTestDatabase } from "./testing";

/**
 * Exit criterion (`docs/IMPLEMENTATION_PLAN.md` M2): migrations run cleanly from
 * an empty database. `createTestDatabase()` starts an EMPTY PGlite and applies
 * every committed migration from `./drizzle`, so this test fails the moment a
 * migration is malformed or missing.
 */
describe("database migrations", () => {
  it("create every core identity table from an empty database", async () => {
    const { db, close } = await createTestDatabase();
    try {
      const result = await db.execute<{ table_name: string }>(sql`
        select table_name
        from information_schema.tables
        where table_schema = 'public'
      `);
      const tables = result.rows.map((row) => row.table_name);

      expect(tables).toEqual(
        expect.arrayContaining([
          "users",
          "sessions",
          "accounts",
          "verifications",
          "families",
          "family_members",
        ]),
      );
    } finally {
      await close();
    }
  });

  it("constrain family roles to owner/parent/viewer via a Postgres enum", async () => {
    const { db, close } = await createTestDatabase();
    try {
      const result = await db.execute<{ enumlabel: string }>(sql`
        select enumlabel
        from pg_enum
        join pg_type on pg_type.oid = pg_enum.enumtypid
        where pg_type.typname = 'family_role'
        order by enumlabel
      `);
      const labels = result.rows.map((row) => row.enumlabel);

      expect(labels).toEqual(["owner", "parent", "viewer"]);
    } finally {
      await close();
    }
  });

  it("enforce a unique membership per (family, user)", async () => {
    const { db, close } = await createTestDatabase();
    try {
      const result = await db.execute<{ indexname: string }>(sql`
        select indexname
        from pg_indexes
        where tablename = 'family_members'
          and indexname = 'family_members_family_user_unq'
      `);
      expect(result.rows).toHaveLength(1);
    } finally {
      await close();
    }
  });
});
