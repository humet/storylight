import { NextResponse } from "next/server";

import { requireActor } from "@/adapters/auth/require-actor";
import { toClientError } from "@/lib/errors";
import { getStoryServices } from "../../service";

/**
 * Reading-progress save endpoint (`docs/04-frontend/story-reader.md` "Reading
 * progress"; `docs/05-backend/api.md` "Route Handlers"). A route handler (not a
 * Server Action) so the reader can persist with `navigator.sendBeacon` on scroll
 * and page-hide. The command service authorises + validates and confirms the
 * story is readable before recording. Returns no content on success.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ storyId: string }> },
): Promise<Response> {
  const { storyId } = await params;
  try {
    const actor = await requireActor();
    const body = (await request.json()) as Record<string, unknown>;
    const { commands } = await getStoryServices();
    await commands.saveReadingProgress(actor, { ...body, storyId });
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
