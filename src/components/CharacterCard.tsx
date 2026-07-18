import { cn } from "./cn";
import { StatusBadge, type CharacterStatusValue } from "./StatusBadge";

export interface CharacterCardProps {
  displayName: string;
  status: CharacterStatusValue;
  apparentAge: number;
  traitCount: number;
  /** Destination for the whole card (the character's review/edit surface). */
  href: string;
  className?: string;
}

/**
 * A tappable summary card for one family character. The entire card is a single
 * ≥44px link target (no tiny inline buttons, no hover-only affordance) so it is
 * comfortable one-handed at 320px. Presentational Server Component — the page
 * supplies the href.
 */
export function CharacterCard({
  displayName,
  status,
  apparentAge,
  traitCount,
  href,
  className,
}: CharacterCardProps) {
  const traitLabel = traitCount === 1 ? "1 trait" : `${traitCount} traits`;

  return (
    <a
      href={href}
      className={cn(
        "flex min-h-[var(--touch-min)] flex-col gap-3 rounded-xl p-4",
        "border border-border bg-surface shadow-sm",
        "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-standard)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
        "hover:border-border-strong",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-display text-lg font-semibold text-ink text-balance">
          {displayName}
        </h3>
        <StatusBadge status={status} />
      </div>

      <p className="font-sans text-sm text-ink-muted">
        Around {apparentAge} · {traitLabel}
      </p>
    </a>
  );
}
