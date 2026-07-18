"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components";
import { continueSeriesAction } from "./continue-action";

/**
 * "Continue tonight" — starts the next chapter and moves to the progress screen.
 * Concurrent taps collapse to one workflow (deterministic requestId), so a double
 * tap is safe.
 */
export function ContinueButton({
  storyId,
  chapterNumber,
}: {
  storyId: string;
  chapterNumber: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    const result = await continueSeriesAction(storyId);
    if (result.ok) {
      router.push(
        `/app/series/${storyId}/progress?w=${encodeURIComponent(result.workflowId)}`,
      );
      return;
    }
    setBusy(false);
    setError(result.error.message);
  }

  return (
    <div className="flex flex-col gap-2">
      <Button size="lg" fullWidth onClick={go} disabled={busy}>
        {busy ? "Beginning…" : `Continue tonight — Chapter ${chapterNumber}`}
      </Button>
      {error ? (
        <p role="alert" className="font-sans text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
