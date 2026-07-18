import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireActor } from "@/adapters/auth/require-actor";
import { signOutAction } from "@/app/(auth)/actions";
import { isDomainError } from "@/lib/errors";

export const metadata: Metadata = {
  title: "Your library — Storylight",
};

// Authenticated, per-request page: identity is resolved from the session cookie
// on every request, so it must never be statically prerendered at build time.
export const dynamic = "force-dynamic";

export default async function AppShellPage() {
  try {
    await requireActor();
  } catch (error) {
    // Unauthenticated visitors are sent to sign-in; any other failure is a real
    // error. `redirect()` throws its control-flow signal, so it is called
    // outside the try block above.
    if (isDomainError(error) && error.code === "UNAUTHORISED") {
      redirect("/sign-in");
    }
    throw error;
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-2">
        <p className="text-sm font-medium tracking-wide text-neutral-500 uppercase">
          Storylight
        </p>
        <h1 className="text-3xl font-semibold text-neutral-900 dark:text-neutral-50">
          Your family library
        </h1>
        <p className="text-base text-neutral-600 dark:text-neutral-300">
          Your stories will appear here. Creating and reading arrives in the
          next milestones.
        </p>
      </header>

      {/* Parent controls remain available but visually secondary during reading
          (domain rule 11). */}
      <footer className="mt-auto border-t border-neutral-200 pt-6 dark:border-neutral-800">
        <form action={signOutAction}>
          <button
            type="submit"
            className="text-sm font-medium text-neutral-500 underline dark:text-neutral-400"
          >
            Sign out
          </button>
        </form>
      </footer>
    </main>
  );
}
