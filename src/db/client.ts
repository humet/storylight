import "server-only";

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { getEnv, isDevLikeEnv } from "@/lib/env";
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

/**
 * The memoised database, cached on `globalThis` under a PROCESS-GLOBAL symbol
 * (`Symbol.for`) rather than a module-scoped `let`.
 *
 * WHY: in Next.js dev/build the bundler can instantiate this module more than
 * once (a route handler and a page can land in separate server bundles), and a
 * module-scoped cache would then create ONE `Database` PER BUNDLE. For the real
 * `pg` pool that is merely wasteful, but for the dev/test file-backed PGlite it
 * is a correctness bug: two PGlite handles over the same data directory hold
 * DIVERGENT in-memory state, so a write through one is invisible to the other
 * (e.g. an approval on one handle, a delivery read on the other). Keying the
 * cache on `globalThis` collapses every bundle copy onto ONE instance — the
 * standard Next.js singleton pattern. Tests build their own DB via `./testing`
 * and never touch this path.
 */
const DB_CACHE_KEY = Symbol.for("storylight.db.instance");

type DbGlobal = typeof globalThis & {
  [DB_CACHE_KEY]?: Promise<Database>;
};

async function create(): Promise<Database> {
  const env = getEnv();

  if (env.DATABASE_URL) {
    const pool = new Pool({ connectionString: env.DATABASE_URL });
    return drizzle(pool, { schema });
  }

  if (!isDevLikeEnv(env)) {
    // Positive dev signal required: unset NODE_ENV counts as production, so a
    // misconfigured deploy can never silently boot on an ephemeral local DB.
    throw new Error(
      "DATABASE_URL is required outside explicit development/test. Refusing to fall back to the dev PGlite database.",
    );
  }

  // Dev/test-only fallback. Dynamic import keeps PGlite (a WASM dependency) out
  // of the production server bundle and off the real Postgres path.
  const { createDevPglite } = await import("./dev-pglite");
  return createDevPglite(schema);
}

/** Lazily build (and memoise) the Drizzle database for the current process. */
export function getDb(): Promise<Database> {
  const store = globalThis as DbGlobal;
  store[DB_CACHE_KEY] ??= create();
  return store[DB_CACHE_KEY];
}
