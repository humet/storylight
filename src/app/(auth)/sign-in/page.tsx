import Link from "next/link";
import type { Metadata } from "next";

import { signInAction } from "../actions";

export const metadata: Metadata = {
  title: "Sign in — Storylight",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-6 py-16">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-50">
          Sign in
        </h1>
        <p className="text-base text-neutral-600 dark:text-neutral-300">
          Welcome back to your family library.
        </p>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-200"
        >
          Email or password is incorrect.
        </p>
      ) : null}

      <form action={signInAction} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
            Email
          </span>
          <input
            type="email"
            name="email"
            autoComplete="email"
            required
            className="min-h-12 rounded-lg border border-neutral-300 px-3 text-base text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
            Password
          </span>
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            required
            className="min-h-12 rounded-lg border border-neutral-300 px-3 text-base text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50"
          />
        </label>

        <button
          type="submit"
          className="mt-2 inline-flex min-h-12 items-center justify-center rounded-full bg-neutral-900 px-6 text-base font-medium text-neutral-50 dark:bg-neutral-50 dark:text-neutral-900"
        >
          Sign in
        </button>
      </form>

      <p className="text-sm text-neutral-600 dark:text-neutral-300">
        Need an account?{" "}
        <Link href="/sign-up" className="font-medium underline">
          Create one
        </Link>
      </p>
    </main>
  );
}
