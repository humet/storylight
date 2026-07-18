"use server";

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
