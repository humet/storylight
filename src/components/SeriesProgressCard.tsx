import { cn } from "./cn";

export interface SeriesProgressCardProps {
  title: string | null;
  /** Chapters published so far. */
  published: number;
  /** Planned total chapters. */
  total: number;
  /** True while the series (its first chapter) is still being set up. */
  generating: boolean;
  href: string;
  className?: string;
}

/**
 * A tappable card for one SERIES in the library or on home. Shows spoiler-free
 * progress — chapters published of the planned total — as words AND a quiet bar
 * (colour is never the only signal, `accessibility.md`). The whole card is one
 * ≥44px link target, comfortable one-handed at 320px (`mobile-ux.md`).
 * Presentational Server Component; the page supplies the href.
 */
export function SeriesProgressCard({
  title,
  published,
  total,
  generating,
  href,
  className,
}: SeriesProgressCardProps) {
  const heading = title ?? "A story to continue";
  const isComplete = total > 0 && published >= total;
  const pct = total > 0 ? Math.round((published / total) * 100) : 0;
  const secondary = generating
    ? "Being set up"
    : isComplete
      ? `Complete · ${total} chapters`
      : `${published} of ${total} chapters`;

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
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-display text-lg font-semibold text-ink text-balance">
          {heading}
        </h3>
        <span className="rounded-full border border-border-strong px-2 py-0.5 font-sans text-xs font-medium text-ink-muted">
          Series
        </span>
      </div>
      <p className="font-sans text-sm text-ink-muted">
        {generating ? (
          <span
            aria-hidden
            className="mr-2 inline-block size-2 animate-pulse rounded-full bg-accent align-middle"
          />
        ) : null}
        {secondary}
      </p>
      {total > 0 ? (
        <span
          aria-hidden
          className="h-1.5 w-full overflow-hidden rounded-full bg-border"
        >
          <span
            className="block h-full rounded-full bg-accent"
            style={{ width: `${pct}%` }}
          />
        </span>
      ) : null}
    </a>
  );
}
