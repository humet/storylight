import { NextResponse } from "next/server";

import { requireActor } from "@/adapters/auth/require-actor";
import { toClientError } from "@/lib/errors";
import { getSeriesServices } from "../../../../service";

/**
 * Per-chapter series reading-progress save endpoint (`docs/04-frontend/story-reader.md`
 * "Reading progress"). A route handler (not a Server Action) so the series chapter
 * reader can persist with `navigator.sendBeacon` on scroll and page-hide, exactly
 * like the one-off reader. The storyId + chapterNumber come from the path; the
 * beacon body carries only scrollProportion + paragraphAnchor + completed. The
 * command service authorises + validates and confirms the chapter is readable
 * before recording. Returns no content on success.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ storyId: string; chapterNumber: string }> },
): Promise<Response> {
  const { storyId, chapterNumber } = await params;
  try {
    const actor = await requireActor();
    const body = (await request.json()) as Record<string, unknown>;
    const { commands } = await getSeriesServices();
    await commands.saveSeriesProgress(actor, {
      ...body,
      storyId,
      chapterNumber: Number.parseInt(chapterNumber, 10),
    });
    return new NextResponse(null, {
      status: 204,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const safe = toClientError(error);
    const status = safe.code === "UNAUTHORISED" ? 401 : 400;
    return NextResponse.json(safe, { status });
  }
}
