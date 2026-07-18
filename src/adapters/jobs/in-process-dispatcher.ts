import type {
  DispatchOptions,
  JobDispatcher,
} from "@/application/ports/job-dispatcher";
import type { WorkflowEngine } from "@/application/workflow-engine";

/**
 * The in-process dev/test {@link JobDispatcher}. It drives the SAME engine
 * against the SAME database as production would — the difference is only WHERE
 * the durable compute lives: here it is a background promise in the running Node
 * process (fine for `next dev` and Playwright, which are long-lived), whereas the
 * WDK adapter uses Vercel Workflow so a drive survives a deploy.
 *
 * `dispatch` returns as soon as the drive is handed off (it does NOT await the
 * workflow finishing) — matching the port contract — and tracks the background
 * promise so tests (and a graceful shutdown) can `await settled()`. Errors in a
 * background drive are swallowed after `onError` so a rejected floating promise
 * never crashes the process; the workflow's own `failed` state is the record of
 * record.
 *
 * `maxStages` is honoured so a test can tell it to stop between stages and
 * simulate a crash, then resume with a fresh dispatcher/engine.
 */
export interface InProcessDispatcherDeps {
  engine: WorkflowEngine;
  /** Sleep used for retry back-off; tests pass a near-instant sleep. */
  sleep?: (ms: number) => Promise<void>;
  onError?: (error: unknown, workflowId: string) => void;
  /**
   * SERIAL mode (the composed dev/e2e app). The dev database is a SINGLE-connection
   * PGlite, so two workflow drives running `db.transaction()` concurrently would
   * interleave BEGIN/COMMIT on one connection and stall. In serial mode every drive
   * is chained so only ONE runs at a time — matching the single connection — which
   * keeps background image jobs from colliding with foreground text workflows.
   * Tests that need genuine concurrency leave this off (the default). Production uses
   * the WDK dispatcher, where each drive is independently durable.
   */
  serial?: boolean;
}

export interface InProcessJobDispatcher extends JobDispatcher {
  /** Await all in-flight background drives (tests + graceful shutdown). */
  settled(): Promise<void>;
}

export function createInProcessJobDispatcher(
  deps: InProcessDispatcherDeps,
): InProcessJobDispatcher {
  const { engine, sleep, onError, serial } = deps;
  const inFlight = new Set<Promise<unknown>>();

  // Serial mode runs ONE drive at a time (single-connection dev PGlite), with a
  // two-level queue: interactive drives (a parent is waiting) jump ahead of
  // queued background drives (illustration jobs), so a burst of image work can
  // never starve a story/chapter workflow past its polling window.
  type Queued = { run: () => Promise<void>; resolve: () => void };
  const interactiveQueue: Queued[] = [];
  const backgroundQueue: Queued[] = [];
  let pumping = false;

  async function pump(): Promise<void> {
    if (pumping) return;
    pumping = true;
    try {
      for (;;) {
        const next = interactiveQueue.shift() ?? backgroundQueue.shift();
        if (!next) break;
        await next.run();
        next.resolve();
      }
    } finally {
      pumping = false;
    }
  }

  function runDrive(workflowId: string, options?: DispatchOptions) {
    return engine
      .runToCompletion(workflowId, { sleep, maxStages: options?.maxStages })
      .then(() => undefined)
      .catch((error: unknown) => {
        if (onError) onError(error, workflowId);
        else console.error(`[workflow] drive failed for ${workflowId}`, error);
      });
  }

  function enqueueSerial(
    workflowId: string,
    options?: DispatchOptions,
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      const queued: Queued = {
        run: () => runDrive(workflowId, options),
        resolve,
      };
      if (options?.priority === "background") backgroundQueue.push(queued);
      else interactiveQueue.push(queued);
      void pump();
    });
  }

  return {
    async dispatch(
      workflowId: string,
      options?: DispatchOptions,
    ): Promise<void> {
      const drive = serial
        ? enqueueSerial(workflowId, options)
        : runDrive(workflowId, options);
      inFlight.add(drive);
      void drive.finally(() => inFlight.delete(drive));
    },

    async settled(): Promise<void> {
      // Drain iteratively: a drive can enqueue nothing new here, but awaiting a
      // snapshot then re-checking keeps this correct if that ever changes.
      while (inFlight.size > 0) {
        await Promise.all([...inFlight]);
      }
    },
  };
}
