import type { Metadata } from "next";
import Link from "next/link";

import { signOutAction } from "@/app/(auth)/actions";
import {
  buttonClassName,
  EmptyState,
  SeriesProgressCard,
  StoryCard,
} from "@/components";
import { actorOrRedirect } from "./guard";
import { getStoryServices } from "./stories/service";

export const metadata: Metadata = {
  title: "Your library — Storylight",
};

// Authenticated, per-request page: identity is resolved from the session cookie
// on every request, so it must never be statically prerendered at build time.
export const dynamic = "force-dynamic";

export default async function AppHomePage() {
  const actor = await actorOrRedirect();
  const { queries } = await getStoryServices();
  const home = await queries.getHome(actor);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-8 px-5 py-10">
      <header className="flex flex-col gap-2">
        <p className="font-sans text-sm font-medium tracking-wide text-ink-muted uppercase">
          Storylight
        </p>
        <h1 className="font-display text-3xl font-semibold text-ink text-balance">
          Your family library
        </h1>
      </header>

      {/* Priority 1: continue the current series (`mobile-ux.md` Home order). */}
      {home.continueSeries ? (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-xl font-semibold text-ink">
            Continue tonight
          </h2>
          <SeriesProgressCard
            title={home.continueSeries.title}
            published={home.continueSeries.seriesProgress?.published ?? 0}
            total={home.continueSeries.seriesProgress?.total ?? 0}
            generating={false}
            href={`/app/series/${home.continueSeries.id}`}
          />
        </section>
      ) : null}

      {/* Priority 2: read a recent one-off again. */}
      {home.continueStory ? (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-xl font-semibold text-ink">
            Read again
          </h2>
          {home.continueStory.type === "series" ? (
            <SeriesProgressCard
              title={home.continueStory.title}
              published={home.continueStory.seriesProgress?.published ?? 0}
              total={home.continueStory.seriesProgress?.total ?? 0}
              generating={false}
              href={`/app/series/${home.continueStory.id}`}
            />
          ) : (
            <StoryCard
              title={home.continueStory.title}
              state="published"
              href={`/app/stories/${home.continueStory.id}`}
            />
          )}
        </section>
      ) : null}

      {/* Priority 3: create a new adventure. */}
      {home.hasActiveCharacters ? (
        <section className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5">
          <h2 className="font-display text-xl font-semibold text-ink">
            New adventure
          </h2>
          <p className="font-sans text-base text-ink-soft text-pretty">
            Tell Storylight what tonight&rsquo;s story should be about.
          </p>
          <Link
            href="/app/create"
            className={buttonClassName({ size: "lg", fullWidth: true })}
          >
            Create tonight&rsquo;s story
          </Link>
        </section>
      ) : (
        <EmptyState
          title="Your family library is waiting for its first adventure"
          description="Add a character your stories can follow, then write tonight's story together."
          action={
            <Link
              href="/app/characters/new"
              className={buttonClassName({ size: "lg", fullWidth: true })}
            >
              Add your first character
            </Link>
          }
        />
      )}

      {home.recentStories.length > 0 ? (
        <section className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-xl font-semibold text-ink">
              Library
            </h2>
            <Link
              href="/app/library"
              className="font-sans text-sm font-medium text-accent"
            >
              See all
            </Link>
          </div>
          <ul className="flex flex-col gap-3">
            {home.recentStories.map((story) => (
              <li key={story.id}>
                {story.type === "series" ? (
                  <SeriesProgressCard
                    title={story.title}
                    published={story.seriesProgress?.published ?? 0}
                    total={story.seriesProgress?.total ?? 0}
                    generating={story.status === "generating"}
                    href={
                      story.status === "generating" &&
                      (story.seriesProgress?.published ?? 0) === 0
                        ? `/app/series/${story.id}/progress`
                        : `/app/series/${story.id}`
                    }
                  />
                ) : (
                  <StoryCard
                    title={story.title}
                    state={
                      story.status === "generating" ? "generating" : "published"
                    }
                    href={
                      story.status === "generating"
                        ? `/app/stories/${story.id}/progress`
                        : `/app/stories/${story.id}`
                    }
                  />
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <nav className="flex flex-col gap-2">
        <Link
          href="/app/characters"
          className={buttonClassName({
            variant: "secondary",
            fullWidth: true,
          })}
        >
          Manage characters
        </Link>
        <Link
          href="/app/parent/settings"
          className="inline-flex min-h-[var(--touch-min)] items-center justify-center font-sans text-sm font-medium text-ink-muted"
        >
          Story settings
        </Link>
      </nav>

      <footer className="mt-auto border-t border-border pt-6">
        <form action={signOutAction}>
          <button
            type="submit"
            className="font-sans text-sm font-medium text-ink-muted underline"
          >
            Sign out
          </button>
        </form>
      </footer>
    </main>
  );
}
