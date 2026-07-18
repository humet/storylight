"use client";

import { useId, type ReactNode, type TextareaHTMLAttributes } from "react";
import { cn } from "./cn";

export interface TextAreaProps extends Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "id"
> {
  /** Visible label — always present, never a placeholder-only field. */
  label: string;
  /** Quiet helper text shown beneath the field. */
  hint?: ReactNode;
  /** Error message. When set, the field is marked invalid for assistive tech. */
  error?: ReactNode;
  /** Stable id override; otherwise generated for label/description wiring. */
  id?: string;
}

/**
 * A multi-line text input for longer, reflective answers (trait descriptions,
 * behaviour notes). Client component: it wires the label, hint, and error to the
 * control via `useId` for assistive technology, mirroring {@link TextField}.
 */
export function TextArea({
  label,
  hint,
  error,
  id,
  className,
  required,
  rows = 3,
  ...props
}: TextAreaProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;
  const invalid = Boolean(error);

  const describedBy =
    cn(hint ? hintId : undefined, invalid ? errorId : undefined) || undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={fieldId}
        className="font-sans text-sm font-medium text-ink"
      >
        {label}
        {required ? (
          <span className="text-danger" aria-hidden="true">
            {" *"}
          </span>
        ) : null}
      </label>

      <textarea
        id={fieldId}
        required={required}
        rows={rows}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={cn(
          "min-h-[var(--touch-min)] w-full rounded-md px-3.5 py-2.5",
          "bg-surface font-sans text-base text-ink placeholder:text-ink-muted",
          "border transition-colors duration-[var(--duration-fast)] ease-[var(--ease-standard)]",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
          "resize-y",
          invalid ? "border-danger" : "border-border-strong",
          className,
        )}
        {...props}
      />

      {hint && !invalid ? (
        <p id={hintId} className="font-sans text-sm text-ink-muted">
          {hint}
        </p>
      ) : null}

      {invalid ? (
        <p id={errorId} className="font-sans text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
