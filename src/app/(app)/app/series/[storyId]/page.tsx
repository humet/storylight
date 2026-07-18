import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { actorOrRedirect } from "../../guard";
import { getSeriesServices } from "../service";
import { ContinueButton } from "./ContinueButton";

export const metadata: Metadata = {
  title: "Storylight series",
};

// Per-request: the series overview is resolved from the session's family; it is
// spoiler-free (title + premise + published chapters only), never the bible.
export const dynamic = "force-dynamic";

export default async function SeriesOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ storyId: string }>;
  searchParams: Promise<{ continueError?: string }>;
}) {
  const { storyId } = await params;
  const { continueError } = await searchParams;
  const actor = await actorOrRedirect();
  const { queries } = await getSeriesServices();

  const overview = await queries.getSeriesOverview(actor, storyId);
  if (!overview) notFound();

  // Nothing published yet — the series is still being set up.
  if (overview.publishedChapterCount === 0) {
    redirect(`/app/series/${storyId}/progress`);
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-8 px-5 py-10">
      <header className="flex flex-col gap-2">
        <Link
          href="/app/library"
          className="inline-flex min-h-[var(--touch-min)] items-center font-sans text-sm font-medium text-accent"
        >
          ← Library
        </Link>
        <h1 className="font-display text-3xl font-semibold text-ink text-balance">
          {overview.title}
        </h1>
        <p className="font-sans text-base text-ink-soft text-pretty">
          {overview.premise}
        </p>
        <p className="font-sans text-sm text-ink-muted">
          {overview.publishedChapterCount} of {overview.chapterCount} chapters
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-xl font-semibold text-ink">
          Chapters
        </h2>
        <ol className="flex flex-col gap-2">
          {overview.chapters.map((chapter) => (
            <li key={chapter.chapterNumber}>
              <Link
                href={`/app/series/${storyId}/chapters/${chapter.chapterNumber}`}
                className="flex min-h-[var(--touch-min)] items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                <span className="flex flex-col">
                  <span className="font-sans text-xs font-medium text-ink-muted uppercase">
                    Chapter {chapter.chapterNumber}
                  </span>
                  <span className="font-display text-lg font-semibold text-ink">
                    {chapter.title}
                  </span>
                </span>
                <span aria-hidden className="text-accent">
                  →
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      {overview.isComplete ? (
        <section className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-5 text-center">
          <p className="font-display text-lg font-semibold text-ink">
            The whole story is told
          </p>
          <p className="font-sans text-sm text-ink-soft text-pretty">
            Every chapter is here to read again, any night.
          </p>
        </section>
      ) : overview.nextChapterNumber !== null ? (
        <ContinueButton
          storyId={storyId}
          chapterNumber={overview.nextChapterNumber}
          errorMessage={continueError ?? null}
        />
      ) : null}
    </main>
  );
}
