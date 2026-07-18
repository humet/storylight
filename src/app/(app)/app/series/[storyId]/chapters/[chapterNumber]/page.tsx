import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ReaderImage, ReaderTypographyControls } from "@/components";
import { actorOrRedirect } from "../../../../guard";
import { ReaderProgress } from "../../../../stories/[storyId]/ReaderProgress";
import { getSeriesServices } from "../../../service";

export const metadata: Metadata = {
  title: "Storylight",
};

// Per-request: family-private chapter content; never statically prerendered.
export const dynamic = "force-dynamic";

export default async function SeriesChapterReaderPage({
  params,
}: {
  params: Promise<{ storyId: string; chapterNumber: string }>;
}) {
  const { storyId, chapterNumber } = await params;
  const n = Number.parseInt(chapterNumber, 10);
  if (!Number.isInteger(n) || n < 1) notFound();

  const actor = await actorOrRedirect();
  const { queries } = await getSeriesServices();
  const reader = await queries.getSeriesChapter(actor, storyId, n);
  if (!reader) notFound();

  // Group illustration slots by the position they render at (0 = before all prose).
  const slotsByPosition = new Map<number, typeof reader.illustrations>();
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
        specId={slot.specId}
        status={slot.status}
        caption={slot.caption}
        aspect={slot.aspect}
      />
    ));
  }

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="sticky top-0 z-[var(--z-sticky)] flex items-center justify-between gap-3 border-b border-border bg-canvas/95 px-4 py-2 backdrop-blur">
        <Link
          href={`/app/series/${storyId}`}
          className="inline-flex min-h-[var(--touch-min)] items-center font-sans text-sm font-medium text-accent"
        >
          ← Close book
        </Link>
        <ReaderTypographyControls />
      </header>

      <ReaderProgress
        storyId={storyId}
        totalParagraphs={reader.paragraphs.length}
        endpoint={`/app/series/${storyId}/chapters/${reader.chapterNumber}/reading-progress`}
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
          <p className="mb-1 font-sans text-sm font-medium tracking-wide text-ink-muted uppercase">
            Chapter {reader.chapterNumber} of {reader.chapterCount}
          </p>
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

          {/* End-of-chapter treatment — NEVER auto-starts the next chapter. */}
          <footer className="mt-10 flex flex-col items-center gap-5 border-t border-border pt-10 text-center">
            <p aria-hidden className="font-display text-xl text-ink-muted">
              {reader.isFinalChapter
                ? "The End"
                : `End of Chapter ${reader.chapterNumber}`}
            </p>
            {reader.tomorrowPromise ? (
              <p className="font-sans text-base text-ink-soft text-pretty">
                {reader.tomorrowPromise}
              </p>
            ) : reader.isFinalChapter ? (
              <p className="font-sans text-base text-ink-soft text-pretty">
                Sleep well. The whole story is here to read again, any night.
              </p>
            ) : null}

            <div className="flex flex-col items-center gap-3">
              <Link
                href={`/app/series/${storyId}`}
                className="inline-flex min-h-[var(--touch-min)] items-center rounded-lg border border-border-strong bg-surface px-6 font-sans font-medium text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                Close the book
              </Link>
              {reader.hasNextPublishedChapter ? (
                <Link
                  href={`/app/series/${storyId}/chapters/${reader.chapterNumber + 1}`}
                  className="font-sans text-sm font-medium text-accent"
                >
                  Read the next chapter
                </Link>
              ) : null}
            </div>
          </footer>
        </article>
      </main>
    </div>
  );
}
