"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Button, ProgressStage } from "@/components";
import { retryStoryAction } from "./actions";

/**
 * Polls a story's create workflow and moves the parent on when it finishes
 * (`docs/04-frontend/mobile-ux.md` "Progress"; `docs/05-backend/api.md`). It shows
 * calm stage copy (never a raw stage or provider error) via {@link ProgressStage}
 * and, on completion, navigates to the reader. On a non-safety failure it offers a
 * safe retry; a safety block is terminal with a calm explanation. The parent may
 * leave and return — the durable workflow keeps running regardless.
 */
export interface StoryProgressPollerProps {
  storyId: string;
  workflowId: string;
  initialLabel: string;
  initialStatus: "working" | "failed";
  initialErrorCode: string | null;
}

const BASE_INTERVAL_MS = 900;
const MAX_INTERVAL_MS = 4000;

interface StatusView {
  label: string;
  isTerminal: boolean;
  isComplete: boolean;
  isFailed: boolean;
  error: { code: string; message: string } | null;
}

export function StoryProgressPoller({
  storyId,
  workflowId,
  initialLabel,
  initialStatus,
  initialErrorCode,
}: StoryProgressPollerProps) {
  const router = useRouter();
  const [label, setLabel] = useState(initialLabel);
  const [status, setStatus] = useState<"working" | "failed">(initialStatus);
  const [errorCode, setErrorCode] = useState<string | null>(initialErrorCode);
  const [retrying, setRetrying] = useState(false);
  const cancelled = useRef(false);

  useEffect(() => {
    if (status !== "working") return;
    cancelled.current = false;
    let interval = BASE_INTERVAL_MS;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const res = await fetch(
          `/app/stories/${storyId}/status?workflowId=${workflowId}`,
          { cache: "no-store" },
        );
        if (res.ok) {
          const view: StatusView = await res.json();
          if (cancelled.current) return;
          setLabel(view.label);
          if (view.isComplete) {
            router.replace(`/app/stories/${storyId}`);
            return;
          }
          if (view.isFailed) {
            setStatus("failed");
            setErrorCode(view.error?.code ?? null);
            return;
          }
        }
      } catch {
        // Transient hiccup — keep polling with a gentle backoff.
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
  }, [storyId, workflowId, router, status]);

  async function retry() {
    setRetrying(true);
    const result = await retryStoryAction(storyId);
    if (result.ok) {
      setStatus("working");
      setLabel("Trying again");
      setErrorCode(null);
    }
    setRetrying(false);
  }

  if (status === "failed") {
    const isSafety = errorCode === "SAFETY_REJECTION";
    return (
      <div className="flex flex-col gap-4">
        <ProgressStage
          state="failed"
          label={
            isSafety
              ? "This story couldn't be made right for bedtime, so it wasn't created. Nothing was saved."
              : "This story didn't come together. Nothing was saved, and you can try again."
          }
        />
        {!isSafety ? (
          <Button size="lg" fullWidth onClick={retry} disabled={retrying}>
            {retrying ? "Trying again…" : "Try again"}
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <ProgressStage
      label={label}
      hint="You can leave this page — the story will be here when it is ready."
    />
  );
}
