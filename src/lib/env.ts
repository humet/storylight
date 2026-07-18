import "server-only";

import { z } from "zod";

/**
 * Runtime environment validation (Zod v4).
 *
 * CRITICAL: `pnpm build` and CI run with NO environment variables set. Parsing
 * therefore happens LAZILY on first access at request time — never at import
 * time — so importing this module (directly or transitively) can never fail a
 * build. See `docs/decisions/ADR-006-concrete-infrastructure.md` for the
 * concrete infrastructure each variable maps to.
 *
 * M1 scope: the database, object storage, and AI Gateway credentials are not
 * exercised yet (they arrive in M2+), so every deployment-specific value is
 * optional here. Format is still validated when a value IS present, and
 * `requireEnv()` gives call sites a typed failure when a value they depend on
 * is missing at runtime.
 */
const EnvSchema = z.object({
  // SAFE BY DEFAULT: an unset NODE_ENV is treated as production so insecure
  // dev conveniences (fallback secret, PGlite database) can never activate by
  // omission on a host that doesn't set it (Railway, bare Docker, custom
  // servers). Real dev flows always set it explicitly: `next dev` =>
  // development, Vitest => test, `next build`/`next start` => production.
  NODE_ENV: z.enum(["development", "test", "production"]).default("production"),

  // Postgres (Neon via Vercel Marketplace) — wired in M2.
  DATABASE_URL: z.url().optional(),

  // Better Auth — cookie signing secret + canonical URL.
  BETTER_AUTH_SECRET: z.string().min(1).optional(),
  BETTER_AUTH_URL: z.url().optional(),

  // Vercel Blob (private object storage) — wired in a later milestone.
  BLOB_READ_WRITE_TOKEN: z.string().min(1).optional(),

  // Vercel AI Gateway (single key for all model providers) — wired in M6.
  AI_GATEWAY_API_KEY: z.string().min(1).optional(),
});

export type Env = z.infer<typeof EnvSchema>;

let cachedEnv: Env | undefined;

/**
 * Parse and cache `process.env`. Lazy: the first caller at runtime validates,
 * every later caller reuses the cached result. Throws a readable aggregate
 * error only when a value that IS present is malformed.
 */
export function getEnv(): Env {
  if (cachedEnv) return cachedEnv;

  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // Surfaced only on the server during boot/first request — never serialized
    // to a client. Keep it readable for operators.
    const issues = parsed.error.issues
      .map(
        (issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`,
      )
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  cachedEnv = parsed.data;
  return cachedEnv;
}

/**
 * Read a required environment value, throwing a readable server-side error when
 * it is absent. Use at the point of use (e.g. an adapter about to connect),
 * keeping the schema itself lenient so builds never depend on deployment env.
 */
export function requireEnv<K extends keyof Env>(key: K): NonNullable<Env[K]> {
  const value = getEnv()[key];
  if (value === undefined || value === null || value === "") {
    throw new Error(
      `Missing required environment variable ${String(key)}. Set it before using this feature.`,
    );
  }
  return value as NonNullable<Env[K]>;
}

/**
 * Positive dev/test signal for insecure conveniences (fallback auth secret,
 * PGlite database). Requires NODE_ENV to be EXPLICITLY "development" or
 * "test" — anything else, including unset (which defaults to "production"),
 * is treated as production and must refuse insecure fallbacks.
 */
export function isDevLikeEnv(env: Env = getEnv()): boolean {
  return env.NODE_ENV === "development" || env.NODE_ENV === "test";
}

/** Test-only: reset the memoised env so a test can exercise a fresh parse. */
export function resetEnvCacheForTests(): void {
  cachedEnv = undefined;
}
