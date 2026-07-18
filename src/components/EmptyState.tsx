import type { ReactNode } from "react";
import { cn } from "./cn";

export interface EmptyStateProps {
  /** Warm, plain-language heading. */
  title: string;
  /** One or two calm sentences setting up the first useful action. */
  description?: ReactNode;
  /** Optional quiet illustration or motif above the title. Decorative. */
  media?: ReactNode;
  /** Primary action — typically a <Button>. Kept obvious, per mobile-ux. */
  action?: ReactNode;
  /** Optional secondary action, visually quieter. */
  secondaryAction?: ReactNode;
  className?: string;
}

/**
 * A calm, spacious empty state. Makes the first useful action obvious rather
 * than showing an operational dashboard. Presentational Server Component.
 */
export function EmptyState({
  title,
  description,
  media,
  action,
  secondaryAction,
  className,
}: EmptyStateProps) {
  return (
    <section
      className={cn(
        "mx-auto flex max-w-sm flex-col items-center gap-4 px-6 py-12 text-center",
        className,
      )}
    >
      {media ? (
        <div className="text-ink-muted" aria-hidden="true">
          {media}
        </div>
      ) : null}

      <h2 className="font-display text-2xl font-semibold text-ink text-balance">
        {title}
      </h2>

      {description ? (
        <p className="font-sans text-base text-ink-soft text-pretty">
          {description}
        </p>
      ) : null}

      {action || secondaryAction ? (
        <div className="mt-2 flex w-full flex-col items-center gap-3">
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </section>
  );
}
