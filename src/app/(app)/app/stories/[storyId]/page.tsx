import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ReaderImage, ReaderTypographyControls } from "@/components";
import type { ReaderIllustrationSlot } from "@/application/ports/story-repository";
import { actorOrRedirect } from "../../guard";
import { getStoryServices } from "../service";
import { ReaderProgress } from "./ReaderProgress";

export const metadata: Metadata = {
  title: "Storylight",
};

// Per-request: the reader payload is resolved from the session's family; it must
// never be statically prerendered (it contains family-private story content).
export const dynamic = "force-dynamic";

export default async function StoryReaderPage({
  params,
}: {
  params: Promise<{ storyId: string }>;
}) {
  const { storyId } = await params;
  const actor = await actorOrRedirect();
  const { queries } = await getStoryServices();

  const reader = await queries.getStoryReader(actor, storyId);
  if (!reader) {
    // Not readable yet — branch on why, without looping the progress screen.
    const status = await queries.getStoryStatus(actor, storyId);
    if (status === "generating") redirect(`/app/stories/${storyId}/progress`);
    if (status === "blocked" || status === "failed") {
      return (
        <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-6 px-5 py-16 text-center">
          <h1 className="font-display text-2xl font-semibold text-ink text-balance">
            This story isn&rsquo;t available
          </h1>
          <p className="font-sans text-base text-ink-soft text-pretty">
            It couldn&rsquo;t be finished for bedtime, so nothing was saved. You
            can always start a new one.
          </p>
          <Link
            href="/app/create"
            className="font-sans text-base font-medium text-accent"
          >
            Start a new story
          </Link>
        </main>
      );
    }
    notFound();
  }

  // Group illustration slots by the position they render at (0 = before all prose).
  const slotsByPosition = new Map<number, ReaderIllustrationSlot[]>();
  for (const slot of reader.illustrations) {
    const position = Math.min(
      Math.max(slot.afterParagraph, 0),
      reader.paragraphs.length,
    );
    const existing = slotsByPosition.get(position) ?? [];
    existing.push(slot);
    slotsByPosition.set(position, existing);
  }

  function slotsAt(position: number) {
    return (slotsByPosition.get(position) ?? []).map((slot) => (
      <ReaderImage
        key={slot.anchorKey}
        caption={slot.caption}
        aspect={slot.aspect}
      />
    ));
  }

  return (
    <div className="min-h-dvh bg-canvas">
      {/* Reader header — minimal, controls visually secondary (domain rule 11). */}
      <header className="sticky top-0 z-[var(--z-sticky)] flex items-center justify-between gap-3 border-b border-border bg-canvas/95 px-4 py-2 backdrop-blur">
        <Link
          href="/app/library"
          className="inline-flex min-h-[var(--touch-min)] items-center font-sans text-sm font-medium text-accent"
        >
          ← Close book
        </Link>
        <div className="flex items-center gap-2">
          <ReaderTypographyControls />
          <details className="relative">
            <summary className="inline-flex min-h-[var(--touch-min)] min-w-[var(--touch-min)] cursor-pointer list-none items-center justify-center rounded-lg text-ink-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
              <span aria-hidden className="text-xl">
                ⋯
              </span>
              <span className="sr-only">Parent options</span>
            </summary>
            <nav className="absolute right-0 z-[var(--z-overlay)] mt-1 flex w-52 flex-col gap-1 rounded-xl border border-border bg-surface-raised p-2 shadow-lg">
              <Link
                href="/app/parent/settings"
                className="rounded-lg px-3 py-2 font-sans text-sm text-ink hover:bg-accent-soft"
              >
                Story settings
              </Link>
              <Link
                href={`/app/stories/${storyId}`}
                className="rounded-lg px-3 py-2 font-sans text-sm text-ink hover:bg-accent-soft"
              >
                Read again from the top
              </Link>
            </nav>
          </details>
        </div>
      </header>

      <ReaderProgress
        storyId={storyId}
        totalParagraphs={reader.paragraphs.length}
        initial={
          reader.progress
            ? {
                scrollProportion: reader.progress.scrollProportion,
                paragraphAnchor: reader.progress.paragraphAnchor,
              }
            : null
        }
      />

      <main className="mx-auto w-full max-w-2xl px-5 py-10">
        <article
          className="flex flex-col"
          style={{
            fontSize: "calc(var(--reader-font-scale, 1) * var(--text-story))",
            lineHeight: 1.75,
          }}
        >
          <h1 className="mb-8 font-display text-3xl font-semibold text-ink text-balance">
            {reader.title}
          </h1>

          {slotsAt(0)}

          {reader.paragraphs.map((paragraph, index) => (
            <div key={index}>
              <p
                id={`p-${index}`}
                className="mb-6 font-serif text-ink"
                style={{ scrollMarginTop: "5rem" }}
              >
                {paragraph}
              </p>
              {slotsAt(index + 1)}
            </div>
          ))}

          <footer className="mt-10 flex flex-col items-center gap-6 border-t border-border pt-10 text-center">
            <p aria-hidden className="font-display text-xl text-ink-muted">
              The End
            </p>
            <p className="font-sans text-base text-ink-soft text-pretty">
              Sleep well. Tomorrow holds another adventure.
            </p>
            <Link
              href="/app/library"
              className="inline-flex min-h-[var(--touch-min)] items-center rounded-lg border border-border-strong bg-surface px-6 font-sans font-medium text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              Close the book
            </Link>
          </footer>
        </article>
      </main>
    </div>
  );
}
