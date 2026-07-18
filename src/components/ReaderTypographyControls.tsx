"use client";

import { useEffect, useSyncExternalStore } from "react";
import { cn } from "./cn";

export interface ReaderTypographyControlsProps {
  className?: string;
}

const STORAGE_KEY = "storylight:reader-font-scale";
const EVENT = "storylight:reader-font-scale-change";

const SIZES = [
  { value: "1", label: "Comfortable" },
  { value: "1.15", label: "Large" },
  { value: "1.3", label: "Larger" },
] as const;

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function getSnapshot(): string {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored && SIZES.some((s) => s.value === stored) ? stored : "1";
}

/**
 * Adjustable reader text size (`docs/04-frontend/story-reader.md` "Typography":
 * adjustable size; `accessibility.md`: adjustable reader text size). A progressive
 * enhancement — the reader renders at a comfortable default WITHOUT JavaScript;
 * this control sets `--reader-font-scale` on the document root (the reader prose
 * multiplies its size by it) and persists the choice via an external store
 * (`useSyncExternalStore`, the sanctioned client-storage pattern). An accessible
 * radiogroup with ≥44px targets; the label carries the meaning, not colour alone.
 */
export function ReaderTypographyControls({
  className,
}: ReaderTypographyControlsProps) {
  const scale = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => "1", // server snapshot — the comfortable default
  );

  // Apply the current scale to the document root (a DOM side effect, not state).
  useEffect(() => {
    document.documentElement.style.setProperty("--reader-font-scale", scale);
  }, [scale]);

  function apply(value: string) {
    window.localStorage.setItem(STORAGE_KEY, value);
    window.dispatchEvent(new Event(EVENT));
  }

  return (
    <div
      role="radiogroup"
      aria-label="Text size"
      className={cn("flex items-center gap-1", className)}
    >
      {SIZES.map((size, index) => {
        const selected = size.value === scale;
        return (
          <button
            key={size.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={size.label}
            onClick={() => apply(size.value)}
            className={cn(
              "flex min-h-[var(--touch-min)] min-w-[var(--touch-min)] items-center justify-center rounded-lg border px-3",
              "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-standard)]",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
              selected
                ? "border-accent-strong bg-accent-soft text-ink"
                : "border-border-strong bg-surface text-ink-soft",
            )}
          >
            <span
              aria-hidden
              className="font-display font-semibold"
              style={{ fontSize: `${0.85 + index * 0.2}rem` }}
            >
              A
            </span>
          </button>
        );
      })}
    </div>
  );
}
