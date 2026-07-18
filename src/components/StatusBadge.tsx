import { cn } from "./cn";

export type CharacterStatusValue = "draft" | "active" | "retired";

export interface StatusBadgeProps {
  status: CharacterStatusValue;
  className?: string;
}

const LABELS: Record<CharacterStatusValue, string> = {
  draft: "Draft",
  active: "Ready",
  retired: "Resting",
};

const STYLES: Record<CharacterStatusValue, string> = {
  // Warm, quiet pills — never alarming, readable in both themes.
  draft: "bg-accent-soft text-accent",
  active: "bg-[color-mix(in_srgb,var(--success)_18%,transparent)] text-success",
  retired: "bg-border text-ink-muted",
};

/**
 * A small, calm status pill for a character. Copy is warm rather than technical
 * (`docs/company/writing-style.md`): a ready-to-read character is "Ready", a
 * retired one is "Resting". Presentational Server Component.
 */
export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5",
        "font-sans text-xs font-medium",
        STYLES[status],
        className,
      )}
    >
      {LABELS[status]}
    </span>
  );
}
