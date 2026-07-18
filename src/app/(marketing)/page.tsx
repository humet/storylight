import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Storylight — personalised bedtime stories",
  description:
    "A private family library of personalised, beautifully illustrated bedtime stories.",
};

export default function MarketingLandingPage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-8 px-6 py-16">
      <div className="flex flex-col gap-4">
        <p className="text-sm font-medium tracking-wide text-neutral-500 uppercase">
          Storylight
        </p>
        <h1 className="text-3xl leading-tight font-semibold text-neutral-900 sm:text-4xl dark:text-neutral-50">
          Bedtime stories made just for your family.
        </h1>
        <p className="text-lg leading-relaxed text-neutral-600 dark:text-neutral-300">
          A private library of personalised, beautifully illustrated stories —
          starring the children you love, continued night after night.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Link
          href="/sign-up"
          className="inline-flex min-h-12 items-center justify-center rounded-full bg-neutral-900 px-6 text-base font-medium text-neutral-50 dark:bg-neutral-50 dark:text-neutral-900"
        >
          Create your family library
        </Link>
        <Link
          href="/sign-in"
          className="inline-flex min-h-12 items-center justify-center rounded-full border border-neutral-300 px-6 text-base font-medium text-neutral-900 dark:border-neutral-700 dark:text-neutral-50"
        >
          Sign in
        </Link>
      </div>
    </main>
  );
}
