import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import type { Database } from "./client";
import * as schema from "./schema";

/**
 * Test harness for the database layer. Builds an EMPTY in-memory PGlite and
 * applies the committed migrations from `./drizzle` — real Postgres semantics,
 * in-process, no Docker and no network (per the M2 environment constraints).
 *
 * Because every integration test starts from an empty database and migrates it,
 * the test suite doubles as the "migrations run cleanly from an empty database"
 * exit criterion (`docs/IMPLEMENTATION_PLAN.md` M2).
 *
 * NOTE: this module intentionally has no `server-only` guard — it is imported by
 * Node test files, not by app runtime code.
 */

const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");

export interface TestDatabase {
  db: Database;
  /** Release the underlying PGlite instance. */
  close: () => Promise<void>;
}

/** Create a fresh, migrated, in-memory database for a single test. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return {
    db: db as unknown as Database,
    close: () => client.close(),
  };
}
