import { NextResponse } from "next/server";

import { requireActor } from "@/adapters/auth/require-actor";
import { getWorkflowService } from "@/adapters/jobs";
import { toClientError } from "@/lib/errors";

/**
 * Workflow status STREAM endpoint for a story's create workflow
 * (`docs/05-backend/api.md` "Route Handlers"; ADR-006 transport = polling with
 * backoff). Returns the CLIENT-SAFE progress view only — parent-friendly labels,
 * never raw prompts, internal stage keys, or provider errors. The progress screen
 * polls this while the story is being written.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ storyId: string }> },
): Promise<Response> {
  await params; // storyId is authorised via the workflow's family, not the URL
  const workflowId = new URL(request.url).searchParams.get("workflowId");

  try {
    const actor = await requireActor();
    if (!workflowId) {
      return NextResponse.json(
        { code: "INVALID_COMMAND", message: "Missing workflow reference." },
        { status: 400 },
      );
    }
    const service = await getWorkflowService();
    const view = await service.getWorkflowStatus(actor, workflowId);
    if (!view) {
      return NextResponse.json(
        { code: "INVALID_COMMAND", message: "That story could not be found." },
        { status: 404 },
      );
    }
    return NextResponse.json(view, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const safe = toClientError(error);
    const status = safe.code === "UNAUTHORISED" ? 401 : 400;
    return NextResponse.json(safe, { status });
  }
}
