"use client";

import { useId, type ReactNode } from "react";
import { cn } from "./cn";

export interface ToggleFieldProps {
  /** What this permission allows, in warm plain language. */
  label: string;
  /** Optional one or two lines explaining the choice to a parent. */
  description?: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  className?: string;
}

/**
 * A labelled on/off switch for a single fictionalisation boundary. Implemented
 * as an accessible `role="switch"` button with a ≥44px target and a visible
 * state that never relies on hover — usable one-handed at 320px. The whole row
 * is the target so a parent can tap comfortably in dim light.
 */
export function ToggleField({
  label,
  description,
  checked,
  onCheckedChange,
  className,
}: ToggleFieldProps) {
  const labelId = useId();
  const descriptionId = useId();

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelId}
      aria-describedby={description ? descriptionId : undefined}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "flex w-full min-h-[var(--touch-min)] items-center justify-between gap-4 rounded-lg px-4 py-3 text-left",
        "border border-border-strong bg-surface",
        "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-standard)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
        className,
      )}
    >
      <span className="flex flex-col gap-0.5">
        <span id={labelId} className="font-sans text-base font-medium text-ink">
          {label}
        </span>
        {description ? (
          <span
            id={descriptionId}
            className="font-sans text-sm text-ink-muted text-pretty"
          >
            {description}
          </span>
        ) : null}
      </span>

      <span
        aria-hidden="true"
        className={cn(
          "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full",
          "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-standard)]",
          checked ? "bg-accent-strong" : "bg-border-strong",
        )}
      >
        <span
          className={cn(
            "inline-block h-5 w-5 rounded-full bg-surface-raised shadow-sm",
            "transition-transform duration-[var(--duration-fast)] ease-[var(--ease-standard)]",
            checked ? "translate-x-6" : "translate-x-1",
          )}
        />
      </span>
    </button>
  );
}
