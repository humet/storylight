import Link from "next/link";
import type { Metadata } from "next";

import { signUpAction } from "../actions";

export const metadata: Metadata = {
  title: "Create your account — Storylight",
};

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-6 py-16">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-50">
          Create your account
        </h1>
        <p className="text-base text-neutral-600 dark:text-neutral-300">
          Start your family&rsquo;s private story library.
        </p>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-200"
        >
          {error === "taken"
            ? "We couldn't create that account. Try a different email."
            : "Please check your details and try again."}
        </p>
      ) : null}

      <form action={signUpAction} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
            Your name
          </span>
          <input
            type="text"
            name="name"
            autoComplete="name"
            required
            className="min-h-12 rounded-lg border border-neutral-300 px-3 text-base text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50"
          />
        </label>

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
            autoComplete="new-password"
            required
            minLength={8}
            className="min-h-12 rounded-lg border border-neutral-300 px-3 text-base text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50"
          />
          <span className="text-xs text-neutral-500 dark:text-neutral-400">
            At least 8 characters.
          </span>
        </label>

        <button
          type="submit"
          className="mt-2 inline-flex min-h-12 items-center justify-center rounded-full bg-neutral-900 px-6 text-base font-medium text-neutral-50 dark:bg-neutral-50 dark:text-neutral-900"
        >
          Create account
        </button>
      </form>

      <p className="text-sm text-neutral-600 dark:text-neutral-300">
        Already have an account?{" "}
        <Link href="/sign-in" className="font-medium underline">
          Sign in
        </Link>
      </p>
    </main>
  );
}
