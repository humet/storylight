import "server-only";

import type { JobDispatcher } from "@/application/ports/job-dispatcher";
import {
  createWorkflowService,
  type WorkflowService,
} from "@/application/workflow-service";
import { createConsoleObservabilityEmitter } from "@/adapters/observability/console-emitter";
import { getEnv, isDevLikeEnv } from "@/lib/env";
import {
  createInProcessJobDispatcher,
  type InProcessJobDispatcher,
} from "./in-process-dispatcher";
import {
  createWorkflowRuntime,
  type WorkflowRuntime,
} from "./workflow-runtime";

/**
 * Server-only composition root for the workflow engine (mirrors `getDb()` /
 * `getObjectStorage()` selection). ONE runtime + dispatcher per process is
 * memoised so an in-process background drive keeps running across requests and
 * `settled()` remains meaningful.
 *
 * Dispatcher selection (like the DB/storage drivers, ADR-006):
 *  - dev/test → the in-process dispatcher drives the shared engine (durable
 *    enough for a long-lived `next dev` / Playwright process, and the honest
 *    thing to exercise offline);
 *  - otherwise → the Vercel Workflow (WDK) dispatcher (durable across deploys),
 *    dynamically imported so the `workflow` package never enters the dev/test/
 *    build graph.
 */

interface Composed {
  runtime: WorkflowRuntime;
  dispatcher: JobDispatcher;
  service: WorkflowService;
}

let cached: Promise<Composed> | undefined;

async function compose(): Promise<Composed> {
  const runtime = await createWorkflowRuntime();

  let dispatcher: JobDispatcher;
  if (isDevLikeEnv(getEnv())) {
    // Serial: the dev/e2e PGlite is single-connection, so drives must not overlap
    // (concurrent `db.transaction()` on one connection stalls). See the dispatcher.
    dispatcher = createInProcessJobDispatcher({
      engine: runtime.engine,
      serial: true,
    });
  } else {
    const { createWdkJobDispatcher } = await import("./wdk-dispatcher");
    dispatcher = createWdkJobDispatcher();
  }
  // Late-bind the dispatcher so the illustration job starter (built inside the
  // registry) can dispatch child image jobs through this same dispatcher.
  runtime.dispatcherRef.current = dispatcher;

  const service = createWorkflowService({
    familyRepository: runtime.familyRepository,
    workflowRepository: runtime.workflowRepository,
    registry: runtime.registry,
    dispatcher,
    emitter: createConsoleObservabilityEmitter(),
  });

  return { runtime, dispatcher, service };
}

function composed(): Promise<Composed> {
  cached ??= compose();
  return cached;
}

/** The workflow command/query service (start/status/cancel/resume). */
export async function getWorkflowService(): Promise<WorkflowService> {
  return (await composed()).service;
}

/** The selected dispatcher (rarely needed directly outside composition). */
export async function getJobDispatcher(): Promise<JobDispatcher> {
  return (await composed()).dispatcher;
}

/**
 * Await all in-flight in-process drives. A no-op under the WDK dispatcher (its
 * durability is external). Useful for graceful shutdown and dev tooling.
 */
export async function settleInProcessDrives(): Promise<void> {
  const { dispatcher } = await composed();
  if ("settled" in dispatcher) {
    await (dispatcher as InProcessJobDispatcher).settled();
  }
}
