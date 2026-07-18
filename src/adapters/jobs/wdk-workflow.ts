import { sleep } from "workflow";

import { createWorkflowRuntime } from "./workflow-runtime";

/**
 * The Vercel Workflow (WDK) DURABLE DRIVER (ADR-002/006). Storylight owns all
 * workflow state in Postgres, so this WDK workflow is intentionally thin: it is
 * "durable compute that calls back into the engine", nothing more. Each stage
 * runs inside a `"use step"` (full Node access, automatic durability); the
 * `"use workflow"` loop orchestrates them and survives deploys.
 *
 * Because the engine is idempotent (it checks each stage's persisted output
 * before running), a WDK replay never duplicates completed work — the durability
 * guarantee lives in OUR tables, and WDK only guarantees the loop keeps running.
 *
 * NOTE (contract-typed, not live-tested here — BUILD_STATE M5): the durability of
 * these directives requires `withWorkflow()` in `next.config` at deploy time. In
 * this repo (no WDK backend, no env) the WDK adapter is never selected — the
 * in-process dispatcher drives the same engine — so the directives stay inert and
 * `pnpm build` is unaffected. The resume EXIT TEST proves durability against the
 * DB-backed engine directly, which is what actually matters.
 */

/** A single durable step: run exactly one stage of the engine. */
async function runOneStage(
  workflowId: string,
  leaseOwner: string,
): Promise<{ done: boolean; backoffMs: number }> {
  "use step";
  const { engine } = await createWorkflowRuntime();
  const outcome = await engine.runNextStage(workflowId, leaseOwner);
  switch (outcome.kind) {
    case "retry":
      return { done: false, backoffMs: outcome.backoffMs };
    case "advanced":
      return { done: false, backoffMs: 0 };
    // completed / failed / terminal / locked — nothing more for this drive to do.
    default:
      return { done: true, backoffMs: 0 };
  }
}

/** The durable driver: advance stages until the workflow is terminal. */
export async function driveWorkflowRun(workflowId: string): Promise<void> {
  "use workflow";
  const leaseOwner = `wdk:${workflowId}`;
  for (;;) {
    const { done, backoffMs } = await runOneStage(workflowId, leaseOwner);
    if (done) return;
    if (backoffMs > 0) await sleep(backoffMs);
  }
}
