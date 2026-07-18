import { NextResponse } from "next/server";

import { requireActor } from "@/adapters/auth/require-actor";
import { getWorkflowService } from "@/adapters/jobs";
import { SYNTHETIC_WORKFLOW_TYPE } from "@/application/workflows/synthetic-workflow";
import { getEnv, isDevLikeEnv } from "@/lib/env";
import { toClientError } from "@/lib/errors";

/**
 * TEMPORARY dev-only trigger for the synthetic multi-stage workflow (M5). It
 * lets a developer kick a real run through the durable engine + in-process
 * dispatcher and then poll its status, so the engine can be exercised in a
 * running app without a real consumer. It is FENCED to dev/test — a 404 in
 * production — and is expected to be removed once real story/image workflows
 * (M7+) provide their own triggers.
 *
 *   GET  /app/dev/synthetic-workflow        → start a run, return its handle
 *   GET  /app/dev/synthetic-workflow?id=... → return that run's status view
 */
export async function GET(request: Request): Promise<Response> {
  if (!isDevLikeEnv(getEnv())) {
    return new NextResponse("Not found", { status: 404 });
  }

  try {
    const actor = await requireActor();
    const workflows = await getWorkflowService();
    const id = new URL(request.url).searchParams.get("id");

    if (id) {
      const view = await workflows.getWorkflowStatus(actor, id);
      if (!view) return new NextResponse("Not found", { status: 404 });
      return NextResponse.json(view);
    }

    const handle = await workflows.startWorkflow(
      actor,
      SYNTHETIC_WORKFLOW_TYPE,
      globalThis.crypto.randomUUID(),
      { label: "dev trigger" },
    );
    return NextResponse.json(handle);
  } catch (error) {
    const safe = toClientError(error);
    const status = safe.code === "UNAUTHORISED" ? 401 : 400;
    return NextResponse.json(safe, { status });
  }
}
