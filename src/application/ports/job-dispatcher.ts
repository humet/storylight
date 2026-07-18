/**
 * Durable-compute PORT (`docs/05-backend/background-jobs.md`, ADR-002/006). A
 * `JobDispatcher` is the ONLY thing the application asks to "keep driving this
 * workflow to completion, durably, even if the browser closes or a deployment
 * occurs". It deliberately knows nothing about stages, retries, or state — all of
 * that is Storylight's engine + Postgres (ADR-002: "application code controls
 * retries, review, and state changes"). The dispatcher just calls back into the
 * engine, one stage at a time, until the workflow is terminal.
 *
 * Two adapters are selected like the DB/storage drivers (`src/db/client.ts`):
 *  - a Vercel Workflow (WDK) adapter for deployed environments — durable across
 *    deploys, `src/adapters/jobs/**` (the ESLint boundary keeps the `workflow`
 *    package there);
 *  - an in-process dev/test dispatcher that drives the SAME engine against the
 *    SAME database, and can be told to stop between stages to simulate a crash.
 *
 * Because the engine is idempotent (every stage checks its persisted output
 * before running), re-dispatching an already-running or already-finished
 * workflow is safe — duplicate dispatches never duplicate provider work.
 */
export interface DispatchOptions {
  /**
   * Dev/test control: run at most this many stages on this dispatch, then park
   * the workflow (resumable). Used to simulate a crash/deploy mid-flight. The
   * WDK adapter ignores it (production drives to completion).
   */
  maxStages?: number;
  /**
   * Scheduling hint (`docs/05-backend/background-jobs.md`: bedtime production
   * traffic is prioritised). "interactive" = a parent is waiting on it (story/
   * chapter workflows); "background" = fill-in work (illustration jobs). The
   * serial in-process dispatcher lets interactive drives jump the queue of
   * pending background drives; the WDK adapter ignores it (every drive there
   * is independently durable). Default: "interactive".
   */
  priority?: "interactive" | "background";
}

export interface JobDispatcher {
  /**
   * Durably drive `workflowId` forward. Returns once the drive has been handed
   * off to durable compute (it does NOT wait for the workflow to finish).
   */
  dispatch(workflowId: string, options?: DispatchOptions): Promise<void>;
}
