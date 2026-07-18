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

/**
 * How long to wait before re-attempting a CLAIM-LOCKED workflow. It matches the
 * engine's default lease (visibility timeout), so a crashed holder's lease has
 * expired by the time this drive retries and can reclaim the run — the same
 * semantics as `runToCompletion({ onLocked: "wait" })`, expressed here per-step
 * so each stage keeps its own durable checkpoint.
 */
const LEASE_RETRY_MS = 60_000;

/** A single durable step: run exactly one stage of the engine. */
async function runOneStage(
  workflowId: string,
): Promise<{ done: boolean; sleepMs: number }> {
  "use step";
  // UNIQUE lease token PER DRIVE ATTEMPT. The engine's guarded writes match on
  // `WHERE lease_owner = :token`, so a constant token (the old `wdk:${id}`) let a
  // STALE drive commit an advance after a NEW drive had reclaimed the lease — a
  // double-advance. A per-attempt uuid means only the drive that currently holds
  // the lease can write; a reclaimed stale drive's writes no-op. The uuid is
  // generated inside this durable step, so a replay reuses the persisted token.
  const leaseOwner = `wdk:${workflowId}:${globalThis.crypto.randomUUID()}`;
  const { engine } = await createWorkflowRuntime();
  const outcome = await engine.runNextStage(workflowId, leaseOwner);
  switch (outcome.kind) {
    case "retry":
      return { done: false, sleepMs: outcome.backoffMs };
    case "advanced":
      return { done: false, sleepMs: 0 };
    case "locked":
      // Held by another (possibly crashed) drive's live lease. Do NOT exit —
      // wait until the lease can expire, then retry and reclaim. Exiting here
      // (the old behaviour) stranded a replayed run forever inside the lease
      // window: `running`, lease expiring, and nothing left to re-drive it.
      return { done: false, sleepMs: LEASE_RETRY_MS };
    // completed / failed / terminal — the run is finished; stop the loop.
    default:
      return { done: true, sleepMs: 0 };
  }
}

/** The durable driver: advance stages until the workflow is TERMINAL. */
export async function driveWorkflowRun(workflowId: string): Promise<void> {
  "use workflow";
  for (;;) {
    const { done, sleepMs } = await runOneStage(workflowId);
    if (done) return;
    if (sleepMs > 0) await sleep(sleepMs);
  }
}
