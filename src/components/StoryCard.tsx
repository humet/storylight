import { cn } from "./cn";

export type StoryCardState = "published" | "generating";

export interface StoryCardProps {
  title: string | null;
  state: StoryCardState;
  /** Destination for the whole card (the reader, or the progress screen). */
  href: string;
  /** Optional secondary line, e.g. "Read again" or "Being written". */
  meta?: string;
  className?: string;
}

/**
 * A tappable card for one story in the library or on home. The whole card is a
 * single ≥44px link target (no tiny inline buttons, no hover-only affordance) so
 * it is comfortable one-handed at 320px (`docs/04-frontend/mobile-ux.md`). A
 * still-generating story reads as calm progress, never a job. Presentational
 * Server Component; the page supplies the href. Colour is never the ONLY signal
 * of state — the meta line carries the words (`accessibility.md`).
 */
export function StoryCard({
  title,
  state,
  href,
  meta,
  className,
}: StoryCardProps) {
  const heading = title ?? "Tonight's story";
  const secondary =
    meta ?? (state === "generating" ? "Being written" : "Read again");

  return (
    <a
      href={href}
      className={cn(
        "flex min-h-[var(--touch-min)] flex-col gap-2 rounded-xl p-4",
        "border border-border bg-surface shadow-sm",
        "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-standard)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
        "hover:border-border-strong",
        className,
      )}
    >
      <h3 className="font-display text-lg font-semibold text-ink text-balance">
        {heading}
      </h3>
      <p className="font-sans text-sm text-ink-muted">
        {state === "generating" ? (
          <span
            aria-hidden
            className="mr-2 inline-block size-2 animate-pulse rounded-full bg-accent align-middle"
          />
        ) : null}
        {secondary}
      </p>
    </a>
  );
}
