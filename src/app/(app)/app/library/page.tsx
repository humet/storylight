import type { Metadata } from "next";
import Link from "next/link";

import { buttonClassName, EmptyState, StoryCard } from "@/components";
import { actorOrRedirect } from "../guard";
import { getStoryServices } from "../stories/service";

export const metadata: Metadata = {
  title: "Library — Storylight",
};

export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const actor = await actorOrRedirect();
  const { queries } = await getStoryServices();
  const stories = await queries.getLibrary(actor);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-8 px-5 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-semibold text-ink text-balance">
          Your library
        </h1>
        <p className="font-sans text-base text-ink-soft text-pretty">
          Every story your family has made, ready to read again.
        </p>
      </header>

      {stories.length === 0 ? (
        <EmptyState
          title="Your family library is waiting for its first adventure"
          description="Write tonight's story and it will appear here to read again and again."
          action={
            <Link
              href="/app/create"
              className={buttonClassName({ size: "lg", fullWidth: true })}
            >
              Create tonight&rsquo;s story
            </Link>
          }
        />
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {stories.map((story) => (
              <li key={story.id}>
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
              </li>
            ))}
          </ul>
          <Link
            href="/app/create"
            className={buttonClassName({
              variant: "secondary",
              className: "self-start",
            })}
          >
            New adventure
          </Link>
        </>
      )}
    </main>
  );
}
