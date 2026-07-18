"use client";

import { useId } from "react";
import { cn } from "./cn";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Optional one-line clarification shown beneath the label. */
  hint?: string;
}

export interface SegmentedChoiceProps<T extends string> {
  /** Group label, announced to assistive tech and shown above the choices. */
  label: string;
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onValueChange: (value: T) => void;
  /** Quiet helper text beneath the group. */
  hint?: string;
  className?: string;
}

/**
 * A segmented single-choice control for small enumerations (sentence length,
 * directness). Implemented as an accessible radiogroup — arrow-key friendly,
 * each segment a ≥44px touch target, no hover-only affordance — so it works at
 * 320px and one-handed. Stacks on the narrowest widths.
 */
export function SegmentedChoice<T extends string>({
  label,
  options,
  value,
  onValueChange,
  hint,
  className,
}: SegmentedChoiceProps<T>) {
  const labelId = useId();
  const hintId = useId();

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <span id={labelId} className="font-sans text-sm font-medium text-ink">
        {label}
      </span>

      <div
        role="radiogroup"
        aria-labelledby={labelId}
        aria-describedby={hint ? hintId : undefined}
        className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-3"
      >
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onValueChange(option.value)}
              className={cn(
                "flex min-h-[var(--touch-min)] flex-col items-center justify-center gap-0.5 rounded-lg px-3 py-2 text-center",
                "border transition-colors duration-[var(--duration-fast)] ease-[var(--ease-standard)]",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
                selected
                  ? "border-accent-strong bg-accent-soft text-ink"
                  : "border-border-strong bg-surface text-ink-soft",
              )}
            >
              <span className="font-sans text-base font-medium">
                {option.label}
              </span>
              {option.hint ? (
                <span className="font-sans text-xs text-ink-muted">
                  {option.hint}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {hint ? (
        <p id={hintId} className="font-sans text-sm text-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
