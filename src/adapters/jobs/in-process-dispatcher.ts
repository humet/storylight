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
}

export interface InProcessJobDispatcher extends JobDispatcher {
  /** Await all in-flight background drives (tests + graceful shutdown). */
  settled(): Promise<void>;
}

export function createInProcessJobDispatcher(
  deps: InProcessDispatcherDeps,
): InProcessJobDispatcher {
  const { engine, sleep, onError } = deps;
  const inFlight = new Set<Promise<unknown>>();

  return {
    async dispatch(
      workflowId: string,
      options?: DispatchOptions,
    ): Promise<void> {
      const drive = engine
        .runToCompletion(workflowId, { sleep, maxStages: options?.maxStages })
        .catch((error: unknown) => {
          if (onError) onError(error, workflowId);
          else
            console.error(`[workflow] drive failed for ${workflowId}`, error);
        });
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
