import type { ReactNode } from "react";
import { cn } from "./cn";

export interface ErrorStateProps {
  /** Calm, honest heading. Never blames the parent, never shows raw errors. */
  title: string;
  /**
   * What happened and what was preserved. Per mobile-ux error recovery, say
   * what is safe and whether the parent can try again.
   */
  description?: ReactNode;
  /**
   * Short reassurance line, e.g. "Your series is safe." Rendered as a quiet
   * pill so it reads as steadying, not alarming.
   */
  reassurance?: ReactNode;
  /** Retry / recovery action — typically a <Button>. */
  action?: ReactNode;
  /** Optional secondary action (e.g. view details behind a parent surface). */
  secondaryAction?: ReactNode;
  className?: string;
}

/**
 * A steady failure surface. Communicates what was preserved and whether the
 * parent can retry — without provider errors or blame. Server Component.
 */
export function ErrorState({
  title,
  description,
  reassurance,
  action,
  secondaryAction,
  className,
}: ErrorStateProps) {
  return (
    <section
      role="alert"
      className={cn(
        "mx-auto flex max-w-sm flex-col items-center gap-4 px-6 py-12 text-center",
        className,
      )}
    >
      <h2 className="font-display text-2xl font-semibold text-ink text-balance">
        {title}
      </h2>

      {description ? (
        <p className="font-sans text-base text-ink-soft text-pretty">
          {description}
        </p>
      ) : null}

      {reassurance ? (
        <p className="rounded-full bg-danger-soft px-4 py-1.5 font-sans text-sm font-medium text-danger">
          {reassurance}
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
