"use client";

import { useEffect, useRef } from "react";

/**
 * Persists and restores reading position (`docs/04-frontend/story-reader.md`
 * "Reading progress": paragraph anchor + scroll proportion; "Scroll position
 * survives refresh"). A progressive enhancement over the server-rendered text —
 * without JavaScript the story still reads top to bottom. On mount it restores to
 * the saved paragraph; while reading it saves (throttled) via `sendBeacon`, and on
 * reaching the closing section it marks the story complete
 * (`story-reader.md`: mark complete at the closing section — no aggressive
 * auto-completion). Reduced-motion friendly: restore is an instant jump.
 */
export interface ReaderProgressProps {
  storyId: string;
  totalParagraphs: number;
  initial: { scrollProportion: number; paragraphAnchor: number } | null;
  /**
   * Where to POST the progress beacon. Defaults to the one-off reading-progress
   * route; the series chapter reader passes its own per-chapter endpoint (which
   * injects the chapter number server-side). The beacon body is identical in both
   * cases (scrollProportion + paragraphAnchor + completed).
   */
  endpoint?: string;
}

const SAVE_INTERVAL_MS = 1500;

export function ReaderProgress({
  storyId,
  totalParagraphs,
  initial,
  endpoint,
}: ReaderProgressProps) {
  const lastSaved = useRef(0);
  const currentAnchor = useRef(initial?.paragraphAnchor ?? 0);
  const completed = useRef(false);

  useEffect(() => {
    // Restore: jump to the saved paragraph (survives refresh).
    if (initial && initial.paragraphAnchor > 0) {
      const el = document.getElementById(`p-${initial.paragraphAnchor}`);
      if (el) el.scrollIntoView({ block: "start", behavior: "auto" });
    }

    function currentParagraph(): number {
      // The topmost paragraph whose top is at or above the viewport middle.
      const mid = window.innerHeight * 0.4;
      let anchor = currentAnchor.current;
      for (let i = 0; i < totalParagraphs; i++) {
        const el = document.getElementById(`p-${i}`);
        if (!el) continue;
        const top = el.getBoundingClientRect().top;
        if (top <= mid) anchor = i;
        else break;
      }
      return anchor;
    }

    function scrollProportion(): number {
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      return max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    }

    function save(force = false) {
      const now = Date.now();
      if (!force && now - lastSaved.current < SAVE_INTERVAL_MS) return;
      lastSaved.current = now;

      const proportion = scrollProportion();
      const anchor = currentParagraph();
      currentAnchor.current = anchor;
      if (proportion > 0.95) completed.current = true;

      const payload = JSON.stringify({
        scrollProportion: proportion,
        paragraphAnchor: anchor,
        completed: completed.current,
      });
      const url = endpoint ?? `/app/stories/${storyId}/reading-progress`;
      if (navigator.sendBeacon) {
        navigator.sendBeacon(
          url,
          new Blob([payload], { type: "application/json" }),
        );
      } else {
        void fetch(url, {
          method: "POST",
          body: payload,
          headers: { "Content-Type": "application/json" },
          keepalive: true,
        });
      }
    }

    function onScroll() {
      save(false);
    }
    function onHide() {
      save(true);
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") onHide();
    });

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", onHide);
      save(true);
    };
  }, [storyId, totalParagraphs, initial, endpoint]);

  return null;
}
