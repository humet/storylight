import "server-only";

import { mkdirSync } from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import type { Database } from "./client";
import type * as Schema from "./schema";

/**
 * Dev/test-only database fallback (see `./client.ts`). A file-backed PGlite
 * instance with the committed migrations applied, so the dev server and the
 * Playwright suite run offline with no real Postgres and no manual setup.
 *
 * This path deliberately self-migrates because it is an ephemeral local
 * convenience; the real Postgres path (node-postgres) NEVER auto-migrates —
 * production runs migrations as an explicit `pnpm db:migrate` step
 * (`docs/05-backend/database.md`). Never reachable in production: `client.ts`
 * throws first when `DATABASE_URL` is absent under `NODE_ENV=production`.
 */

const DEV_DATA_DIR = path.join(process.cwd(), ".pglite", "dev");
const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");

export async function createDevPglite(
  schema: typeof Schema,
): Promise<Database> {
  // PGlite only creates the leaf datadir, not intermediate parents.
  mkdirSync(DEV_DATA_DIR, { recursive: true });
  const client = new PGlite(DEV_DATA_DIR);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  // The PGlite driver exposes the same query builder surface as node-postgres;
  // the app depends only on that shared surface (`Database`).
  return db as unknown as Database;
}
