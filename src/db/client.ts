import "server-only";

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { getEnv } from "@/lib/env";
import * as schema from "./schema";

/**
 * The single database entry point (ADR-005/006). Everything that touches
 * Postgres — repositories, the Better Auth adapter — goes through {@link getDb},
 * so the driver is swappable in one place.
 *
 * Driver selection:
 *  - `DATABASE_URL` set  → node-postgres `Pool` (Neon-compatible). This is the
 *    real path for dev-with-a-real-DB, preview, and production.
 *  - no URL, non-production → a file-backed PGlite instance (dev/test-only
 *    convenience so the app and Playwright run offline with zero setup). See
 *    `./dev-pglite.ts`. Marked dev/test-only and documented in BUILD_STATE.md.
 *  - no URL, production   → hard error (never silently boot without a database).
 *
 * Access is LAZY and async so importing this module never connects, keeping
 * `pnpm build`/CI (no env vars) safe. Tests DO NOT use this entry point — they
 * build their own migrated PGlite via `./testing.ts`.
 */

export type Database = NodePgDatabase<typeof schema>;

export { schema };

let cached: Promise<Database> | undefined;

async function create(): Promise<Database> {
  const env = getEnv();

  if (env.DATABASE_URL) {
    const pool = new Pool({ connectionString: env.DATABASE_URL });
    return drizzle(pool, { schema });
  }

  if (env.NODE_ENV === "production") {
    throw new Error(
      "DATABASE_URL is required in production. Refusing to fall back to the dev PGlite database.",
    );
  }

  // Dev/test-only fallback. Dynamic import keeps PGlite (a WASM dependency) out
  // of the production server bundle and off the real Postgres path.
  const { createDevPglite } = await import("./dev-pglite");
  return createDevPglite(schema);
}

/** Lazily build (and memoise) the Drizzle database for the current process. */
export function getDb(): Promise<Database> {
  cached ??= create();
  return cached;
}
