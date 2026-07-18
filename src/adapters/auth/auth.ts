import "server-only";

import { betterAuth } from "better-auth";
import { memoryAdapter, type MemoryDB } from "better-auth/adapters/memory";
import { nextCookies } from "better-auth/next-js";

import { getEnv } from "@/lib/env";

/**
 * Better Auth adapter — the ONLY module allowed to import the provider SDK
 * (domain rule 12, ESLint-enforced). Everything outside `src/adapters/auth/`
 * depends on the `AuthenticatedActor` boundary, never on Better Auth types.
 *
 * M1 caveats (Postgres + Drizzle arrive in M2, ADR-006):
 *  - Persistence is the in-memory adapter: accounts live for the lifetime of a
 *    single server process. A dev-server restart (or a fresh serverless
 *    instance) empties the store. This is intentional for the M1 shell and is
 *    replaced by the Drizzle adapter in M2.
 *  - Roles and family membership are not yet stored, so `requireActor()`
 *    synthesises them (see `require-actor.ts`).
 *
 * Instantiation is LAZY: `betterAuth()` is only ever called on first request,
 * never at import time, so `pnpm build`/CI (which run with no env vars) never
 * touch it. See `src/lib/env.ts` for the same lazy-validation contract.
 */

const DEV_FALLBACK_SECRET =
  "storylight-dev-insecure-secret-change-me-before-production";

function resolveSecret(): string {
  const env = getEnv();
  if (env.BETTER_AUTH_SECRET) return env.BETTER_AUTH_SECRET;

  if (env.NODE_ENV === "production") {
    // Never boot production auth on a shared, public fallback secret.
    throw new Error(
      "BETTER_AUTH_SECRET is required in production. Refusing to use the dev fallback secret.",
    );
  }

  console.warn(
    "\n[storylight] BETTER_AUTH_SECRET is not set — using an INSECURE dev-only fallback secret.\n" +
      "            Sessions will not survive a secret change and this must NEVER run in production.\n",
  );
  return DEV_FALLBACK_SECRET;
}

// Process-lifetime in-memory store. Shared across the singleton auth instance.
// The memory adapter requires each model's table to exist as an array up front
// (it throws "Model <x> not found" otherwise); these are Better Auth's core
// email+password models. Replaced by the Drizzle schema in M2.
const memoryStore: MemoryDB = {
  user: [],
  session: [],
  account: [],
  verification: [],
};

/**
 * Build the Better Auth instance. Kept as a factory so its precise inferred
 * type flows through `getAuth()` — annotating with the generic `Auth` widens
 * the options and breaks assignment.
 */
function createAuth() {
  const env = getEnv();

  return betterAuth({
    // In-memory persistence for M1 (see caveats above).
    database: memoryAdapter(memoryStore),
    secret: resolveSecret(),
    // Infer the base URL from request headers when not explicitly configured
    // (keeps the dev server booting with zero env vars).
    ...(env.BETTER_AUTH_URL ? { baseURL: env.BETTER_AUTH_URL } : {}),
    emailAndPassword: {
      enabled: true,
      // No email delivery yet (M1) — accounts are usable immediately.
      requireEmailVerification: false,
      minPasswordLength: 8,
    },
    session: {
      // Sensible expiry per docs/05-backend/auth.md.
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // refresh once a day
    },
    advanced: {
      // Secure cookies only when actually served over HTTPS.
      useSecureCookies: env.NODE_ENV === "production",
    },
    trustedOrigins: [
      "http://localhost:3000",
      ...(env.BETTER_AUTH_URL ? [env.BETTER_AUTH_URL] : []),
    ],
    // Must be last: bridges Better Auth's Set-Cookie handling to next/headers
    // so HTTP-only session cookies are written from Server Actions & handlers.
    plugins: [nextCookies()],
  });
}

type AuthInstance = ReturnType<typeof createAuth>;

let cachedAuth: AuthInstance | undefined;

/** Lazily build (and memoise) the Better Auth instance. */
export function getAuth(): AuthInstance {
  cachedAuth ??= createAuth();
  return cachedAuth;
}
