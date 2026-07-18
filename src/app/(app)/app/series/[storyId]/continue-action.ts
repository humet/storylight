"use server";

import { redirect } from "next/navigation";

import { requireActor } from "@/adapters/auth/require-actor";
import { toClientError, type ClientError } from "@/lib/errors";
import { getSeriesServices } from "../service";

/**
 * "Continue tonight" Server Action: start (or resolve the existing) next-chapter
 * workflow for a series. The command derives a DETERMINISTIC requestId per
 * (series, target chapter), so concurrent taps collapse to one workflow — only one
 * workflow ever generates a chapter number.
 */

export type ContinueSeriesResult =
  | { ok: true; storyId: string; workflowId: string; chapterNumber: number }
  | { ok: false; error: ClientError };

export async function continueSeriesAction(
  storyId: string,
): Promise<ContinueSeriesResult> {
  try {
    const actor = await requireActor();
    const { commands } = await getSeriesServices();
    const result = await commands.continueSeries(actor, { storyId });
    return {
      ok: true,
      storyId: result.storyId,
      workflowId: result.workflowId,
      chapterNumber: result.chapterNumber,
    };
  } catch (error) {
    return { ok: false, error: toClientError(error) };
  }
}

/**
 * Form-post variant used by the overview's <form action>. A native form POST
 * works BEFORE hydration (progressive enhancement), so a fast first tap on a
 * freshly-compiled page can never be silently lost — the e2e-observed failure
 * mode of the previous onClick button. Redirects carry the outcome.
 */
export async function continueSeriesFormAction(storyId: string): Promise<void> {
  const result = await continueSeriesAction(storyId);
  if (result.ok) {
    redirect(
      `/app/series/${storyId}/progress?w=${encodeURIComponent(result.workflowId)}`,
    );
  }
  redirect(
    `/app/series/${storyId}?continueError=${encodeURIComponent(result.error.message)}`,
  );
}
