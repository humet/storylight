import "server-only";

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";

import { getDb, schema } from "@/db/client";
import { createFamilyRepository } from "@/db/repositories/family-repository";
import { getEnv, isDevLikeEnv, requireEnv } from "@/lib/env";

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
 * user's family and their `owner` membership. The hook runs AFTER the user row
 * is committed, so it is best-effort, not atomic with user creation — the
 * "every user has ≥1 family" invariant is actually guaranteed by the
 * idempotent reconciliation in `require-actor.ts` (`ensureFamilyForUser`),
 * which heals any account whose bootstrap failed on its next actor resolution.
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

  if (!isDevLikeEnv(env)) {
    // Never boot production auth on a shared, public fallback secret. Positive
    // dev signal required: an unset NODE_ENV counts as production.
    throw new Error(
      "BETTER_AUTH_SECRET is required outside explicit development/test. Refusing to use the dev fallback secret.",
    );
  }

  console.warn(
    "\n[storylight] BETTER_AUTH_SECRET is not set — using an INSECURE dev-only fallback secret.\n" +
      "            Sessions will not survive a secret change and this must NEVER run in production.\n",
  );
  return DEV_FALLBACK_SECRET;
}

/** A sensible default family name from the signing-up user's display name. */
export function defaultFamilyName(userName: string | undefined | null): string {
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

  // Outside explicit development/test the canonical origin must be operator-
  // declared: CSRF/origin trust must not rest on header inference (review
  // finding, 2026-07-18). In dev, header inference keeps zero-env boot working.
  const baseURL = isDevLikeEnv(env)
    ? env.BETTER_AUTH_URL
    : requireEnv("BETTER_AUTH_URL");

  return betterAuth({
    // Postgres/Drizzle persistence (ADR-005/006). Schema keys are plural.
    database: drizzleAdapter(db, {
      provider: "pg",
      schema,
      usePlural: true,
    }),
    secret: resolveSecret(),
    ...(baseURL ? { baseURL } : {}),
    emailAndPassword: {
      enabled: true,
      // No email delivery yet — accounts are usable immediately.
      requireEmailVerification: false,
      minPasswordLength: 8,
    },
    databaseHooks: {
      user: {
        create: {
          // Best-effort family bootstrap. The user row is ALREADY committed
          // when this runs, so a throw here would fail the sign-up response
          // while leaving a working account behind ("email taken" on retry).
          // Swallow + log instead: `ensureFamilyForUser` in require-actor.ts
          // reconciles idempotently on the next actor resolution.
          after: async (user) => {
            try {
              const repository = createFamilyRepository(await getDb());
              await repository.createFamilyWithOwner({
                userId: user.id,
                familyName: defaultFamilyName(user.name),
              });
            } catch (error) {
              console.error(
                `[storylight] Family bootstrap failed for user ${user.id}; ` +
                  "will be reconciled on next actor resolution.",
                error,
              );
            }
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
