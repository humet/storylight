import { cn } from "./cn";

export type ProgressStageState = "working" | "failed" | "done";

export interface ProgressStageProps {
  /** Parent-friendly stage label (`docs/company/writing-style.md`) — never a raw stage key. */
  label: string;
  state?: ProgressStageState;
  /** The story title, once known. */
  title?: string;
  /** Quiet reassurance beneath the label. */
  hint?: string;
  className?: string;
}

/**
 * A calm progress display for a running workflow (`docs/04-frontend/mobile-ux.md`
 * "Progress": real stages, not token streams). It announces stage changes
 * POLITELY (`aria-live="polite"`, `accessibility.md`) and never shows a raw stage
 * key or provider error. Colour is not the only signal of failure — the label
 * carries the words. Presentational; a client poller feeds it the current label.
 */
export function ProgressStage({
  label,
  state = "working",
  title,
  hint,
  className,
}: ProgressStageProps) {
  return (
    <section
      aria-live="polite"
      className={cn(
        "flex flex-col items-center gap-3 rounded-2xl border p-8 text-center",
        state === "failed"
          ? "border-border bg-danger-soft"
          : "border-border bg-surface",
        className,
      )}
    >
      {state === "working" ? (
        <span
          aria-hidden
          className="size-6 animate-spin rounded-full border-2 border-border border-t-accent"
        />
      ) : null}

      {title ? (
        <h2 className="font-display text-xl font-semibold text-ink text-balance">
          {title}
        </h2>
      ) : null}

      <p className="font-sans text-base text-ink text-pretty">
        {state === "working" ? `${label}…` : label}
      </p>

      {hint ? (
        <p className="font-sans text-sm text-ink-soft text-pretty">{hint}</p>
      ) : null}
    </section>
  );
}
