import "server-only";

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";

import { getDb, schema } from "@/db/client";
import { createFamilyRepository } from "@/db/repositories/family-repository";
import { getEnv } from "@/lib/env";

/**
 * Better Auth adapter — the ONLY module allowed to import the provider SDK
 * (domain rule 12, ESLint-enforced). Everything outside `src/adapters/auth/`
 * depends on the `AuthenticatedActor` boundary, never on Better Auth types.
 *
 * Persistence (M2): the Drizzle adapter over the single `src/db` entry point
 * (Postgres in prod/preview, dev PGlite fallback offline). The Better Auth core
 * tables live in `src/db/schema/auth.ts` and are handed to the adapter below;
 * `usePlural: true` matches Better Auth's singular model names (`user`) to our
 * plural table exports (`users`).
 *
 * Sign-up family bootstrap: `databaseHooks.user.create.after` creates the new
 * user's family and their `owner` membership in one transaction, so every user
 * has at least one family (`docs/05-backend/auth.md`). Roles/families are then
 * read back by `require-actor.ts`.
 *
 * Instantiation is LAZY and async: `betterAuth()` is only ever built on first
 * request (after `getDb()` resolves), never at import time, so `pnpm build`/CI
 * (no env vars) never touch it. See `src/lib/env.ts` for the same contract.
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

/** A sensible default family name from the signing-up user's display name. */
function defaultFamilyName(userName: string | undefined | null): string {
  const trimmed = userName?.trim();
  if (!trimmed) return "Your family";
  return `${trimmed}'s family`;
}

/**
 * Build the Better Auth instance. Kept as a factory so its precise inferred type
 * flows through `getAuth()` — annotating with the generic `Auth` widens the
 * options and breaks assignment.
 */
async function createAuth() {
  const env = getEnv();
  const db = await getDb();

  return betterAuth({
    // Postgres/Drizzle persistence (ADR-005/006). Schema keys are plural.
    database: drizzleAdapter(db, {
      provider: "pg",
      schema,
      usePlural: true,
    }),
    secret: resolveSecret(),
    // Infer the base URL from request headers when not explicitly configured
    // (keeps the dev server booting with zero env vars).
    ...(env.BETTER_AUTH_URL ? { baseURL: env.BETTER_AUTH_URL } : {}),
    emailAndPassword: {
      enabled: true,
      // No email delivery yet — accounts are usable immediately.
      requireEmailVerification: false,
      minPasswordLength: 8,
    },
    databaseHooks: {
      user: {
        create: {
          // Bootstrap a family + owner membership atomically after sign-up, so
          // every user always has at least one family to work in.
          after: async (user) => {
            const repository = createFamilyRepository(await getDb());
            await repository.createFamilyWithOwner({
              userId: user.id,
              familyName: defaultFamilyName(user.name),
            });
          },
        },
      },
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

type AuthInstance = Awaited<ReturnType<typeof createAuth>>;

let cachedAuth: Promise<AuthInstance> | undefined;

/** Lazily build (and memoise) the Better Auth instance. */
export function getAuth(): Promise<AuthInstance> {
  cachedAuth ??= createAuth();
  return cachedAuth;
}
