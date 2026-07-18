import "server-only";

import { start } from "workflow/api";

import type { JobDispatcher } from "@/application/ports/job-dispatcher";
import { driveWorkflowRun } from "./wdk-workflow";

/**
 * The Vercel Workflow (WDK) {@link JobDispatcher} for deployed environments. It
 * hands the drive to WDK's durable compute (`start`), which survives a browser
 * close or a deployment — satisfying `docs/05-backend/background-jobs.md`'s
 * durability acceptance criteria. All state remains Storylight's (ADR-002); WDK
 * only keeps the driver loop alive.
 *
 * Contract-typed against `workflow@4` but not live-tested in this repo (no WDK
 * backend / env); it is only selected in a real deployment (`dispatcher.ts`).
 */
export function createWdkJobDispatcher(): JobDispatcher {
  return {
    async dispatch(workflowId: string): Promise<void> {
      // `maxStages` is a dev/test crash-simulation control; production drives to
      // completion, so it is intentionally ignored here.
      await start(driveWorkflowRun, [workflowId]);
    },
  };
}
