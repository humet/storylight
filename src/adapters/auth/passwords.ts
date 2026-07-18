import "server-only";

import { APIError } from "better-auth";
import { headers } from "next/headers";

import {
  DomainError,
  invalidCommandError,
  unauthorisedError,
} from "@/lib/errors";
import { getAuth } from "./auth";

/**
 * Email + password credential operations, mapped to the safe error contract.
 *
 * Raw Better Auth `APIError`s never escape this module: they are translated to
 * typed `DomainError`s so provider internals cannot reach a client
 * (`docs/05-backend/api.md`, domain rule 12). The `nextCookies()` plugin on the
 * auth instance writes the HTTP-only session cookie when these run inside a
 * Server Action or Route Handler.
 */

export interface EmailPasswordCredentials {
  email: string;
  password: string;
}

export interface SignUpInput extends EmailPasswordCredentials {
  name: string;
}

/** Map a provider failure to a client-safe domain error. */
function toDomainError(cause: unknown, stage: string): DomainError {
  if (cause instanceof APIError) {
    return invalidCommandError({
      // Deliberately generic: never disclose which field failed or whether the
      // account exists.
      safeMessage: "Those details could not be used to sign in.",
      internalDetail: `${cause.status}: ${cause.message}`,
      stage,
      cause,
    });
  }
  return invalidCommandError({
    safeMessage: "Something went wrong. Please try again.",
    internalDetail: cause instanceof Error ? cause.message : String(cause),
    stage,
    cause,
  });
}

export async function signUpWithPassword(input: SignUpInput): Promise<void> {
  try {
    const auth = await getAuth();
    await auth.api.signUpEmail({
      body: { email: input.email, password: input.password, name: input.name },
      headers: await headers(),
    });
  } catch (cause) {
    throw toDomainError(cause, "auth.sign-up");
  }
}

export async function signInWithPassword(
  input: EmailPasswordCredentials,
): Promise<void> {
  try {
    const auth = await getAuth();
    await auth.api.signInEmail({
      body: { email: input.email, password: input.password },
      headers: await headers(),
    });
  } catch (cause) {
    throw toDomainError(cause, "auth.sign-in");
  }
}

export async function signOutCurrentSession(): Promise<void> {
  const auth = await getAuth();
  await auth.api.signOut({ headers: await headers() });
}

/**
 * REAUTHENTICATE the current session's user by verifying their password
 * (`docs/05-backend/auth.md`: "reauthentication for destructive deletion";
 * "Destructive actions require appropriate role and confirmation"). Throws a
 * client-safe error if there is no session or the password is wrong — the caller
 * (the family-deletion action) proceeds only on success. Deliberately generic:
 * never discloses whether the account exists or which field failed.
 */
export async function reauthenticateCurrentUser(
  password: string,
): Promise<void> {
  const auth = await getAuth();
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  const email = session?.user?.email;
  if (!email) {
    throw unauthorisedError({
      internalDetail: "Reauthentication requested with no active session.",
      stage: "auth.reauthenticate",
    });
  }
  try {
    // signInEmail is the password-verification primitive; a wrong password throws
    // an APIError which we map to a safe INVALID_COMMAND.
    await auth.api.signInEmail({
      body: { email, password },
      headers: requestHeaders,
    });
  } catch (cause) {
    throw toDomainError(cause, "auth.reauthenticate");
  }
}
