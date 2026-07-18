"use client";

import { useFormStatus } from "react-dom";

import { Button } from "@/components";
import { continueSeriesFormAction } from "./continue-action";

/**
 * "Continue tonight" — starts the next chapter and moves to the progress screen.
 *
 * Rendered as a FORM posting a Server Action (not an onClick handler): a native
 * form POST works before hydration, so a fast first tap on a freshly-compiled
 * page cannot be silently dropped. Concurrent taps collapse to one workflow
 * (deterministic requestId), so a double submit is safe. Failures redirect back
 * here with a safe message in the `continueError` search param.
 */
export function ContinueButton({
  storyId,
  chapterNumber,
  errorMessage,
}: {
  storyId: string;
  chapterNumber: number;
  errorMessage?: string | null;
}) {
  return (
    <form
      action={continueSeriesFormAction.bind(null, storyId)}
      className="flex flex-col gap-2"
    >
      <SubmitButton chapterNumber={chapterNumber} />
      {errorMessage ? (
        <p role="alert" className="font-sans text-sm text-danger">
          {errorMessage}
        </p>
      ) : null}
    </form>
  );
}

function SubmitButton({ chapterNumber }: { chapterNumber: number }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" fullWidth disabled={pending}>
      {pending ? "Beginning…" : `Continue tonight — Chapter ${chapterNumber}`}
    </Button>
  );
}
