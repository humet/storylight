"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Polls a painting workflow's progress and refreshes the page when it finishes
 * (`docs/05-backend/api.md`, ADR-006: polling with backoff). It shows calm
 * loading copy (`docs/company/writing-style.md`) — never a raw stage or error —
 * so the appearance surface feels like a publishing experience, not a job queue.
 *
 * The server component decides WHETHER to render this (only while a workflow is
 * in flight); here we just poll the client-safe status route and, on a terminal
 * status, call `router.refresh()` so the freshly-painted candidates render.
 */
export interface AppearanceProgressProps {
  characterId: string;
  workflowId: string;
  /** Initial parent-friendly label from the server render. */
  initialLabel: string;
}

const BASE_INTERVAL_MS = 900;
const MAX_INTERVAL_MS = 4000;

export function AppearanceProgress({
  characterId,
  workflowId,
  initialLabel,
}: AppearanceProgressProps) {
  const router = useRouter();
  const [label, setLabel] = useState(initialLabel);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    let interval = BASE_INTERVAL_MS;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const res = await fetch(
          `/app/characters/${characterId}/appearance/status?workflowId=${workflowId}`,
          { cache: "no-store" },
        );
        if (res.ok) {
          const view: { label: string; isTerminal: boolean } = await res.json();
          if (cancelled.current) return;
          setLabel(view.label);
          if (view.isTerminal) {
            router.refresh();
            return;
          }
        }
      } catch {
        // Transient network hiccup — keep polling with a gentle backoff.
      }
      if (cancelled.current) return;
      interval = Math.min(interval * 1.5, MAX_INTERVAL_MS);
      timer = setTimeout(poll, interval);
    }

    timer = setTimeout(poll, interval);
    return () => {
      cancelled.current = true;
      clearTimeout(timer);
    };
  }, [characterId, workflowId, router]);

  return (
    <section
      aria-live="polite"
      className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-surface p-8 text-center"
    >
      <span
        aria-hidden
        className="size-6 animate-spin rounded-full border-2 border-border border-t-accent"
      />
      <p className="font-sans text-base text-ink text-pretty">{label}…</p>
      <p className="font-sans text-sm text-ink-soft text-pretty">
        You can leave this page — the paintings will be here when they are
        ready.
      </p>
    </section>
  );
}
