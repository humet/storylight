import type { FamilyCapability } from "@/domain/authorization";
import {
  classifyFailure,
  computeBackoffMs,
  DEFAULT_RETRY_POLICY,
  isRetryExhausted,
  type RetryPolicy,
  toWorkflowError,
} from "@/domain/workflow-retry";
import { transitionWorkflowStatus } from "@/domain/workflow-transition";
import type {
  WorkflowError,
  WorkflowExecution,
  WorkflowStatus,
} from "@/domain/workflow";
import { DomainError, invalidCommandError } from "@/lib/errors";
import type { ZodType } from "zod";
import type {
  StageLineage,
  WorkflowRepository,
} from "./ports/workflow-repository";

/**
 * The Lantern Engine's execution core (`docs/02-storytelling/story-engine.md`,
 * `docs/03-ai/orchestration.md`, ADR-002). It is deterministic and owns nothing
 * a model can influence: given a REGISTRY of workflow definitions (type → ordered
 * named stages + handlers) and the {@link WorkflowRepository}, it runs one stage
 * at a time with these guarantees:
 *
 *  1. IDEMPOTENCY — before running a stage it checks the persisted stage output;
 *     if present it SKIPS the handler ("every job checks the workflow and stage
 *     output before invoking a provider", `docs/05-backend/background-jobs.md`).
 *  2. ATOMIC ADVANCE — a stage's validated output is persisted ATOMICALLY with
 *     advancing `currentStage`, so a crash never leaves an output without its
 *     advance or vice-versa (the skip in (1) covers the reverse-order window).
 *  3. RETRY + BACK-OFF — a retryable failure records the attempt + a back-off
 *     schedule and parks the workflow (resumable); exhausted or non-retryable
 *     failures DEAD-LETTER to `failed` with a safe error and resumable state.
 *  4. CONCURRENCY — a lease claim means one workflow id can't run its next stage
 *     twice concurrently (the repository's conditional claim is the guard).
 *
 * The engine is pure of IO except through the repository port; stage handlers do
 * the actual work (calling other application services), never provider SDKs
 * directly.
 */

/** Context handed to a stage handler. `input` is the workflow's stored command. */
export interface StageContext {
  execution: WorkflowExecution;
  input: unknown;
  /** Attempts already made against this stage (0 on the first run). */
  attempt: number;
  /** Read a prior stage's persisted output (for stages that build on earlier ones). */
  getStageOutput(stageKey: string): Promise<unknown | undefined>;
}

/** A stage's result: its output plus optional generation lineage (M6+). */
export interface StageResult {
  output: unknown;
  lineage?: StageLineage;
}

export type StageHandler = (
  ctx: StageContext,
) => Promise<StageResult | void> | StageResult | void;

export interface WorkflowStage {
  key: string;
  /** Parent-friendly loading copy shown while this stage runs (writing-style.md). */
  label: string;
  run: StageHandler;
}

export interface WorkflowDefinition<Input = unknown> {
  type: string;
  /** Capability the actor must hold to start this workflow (family-scoped). */
  capability: FamilyCapability;
  /** Validates the command input at the boundary (IDs + metadata only). */
  inputSchema: ZodType<Input>;
  /** Ordered, named stages. Runs first → last. */
  stages: WorkflowStage[];
  /** Copy shown when queued/parked before a specific stage label applies. */
  pendingLabel: string;
  retryPolicy?: RetryPolicy;
  /** Extract the domain entity this workflow acts on (for correlation lookups). */
  entityId?: (input: Input) => string | undefined;
}

/**
 * A definition with its input type erased, as stored in the registry. Authors
 * write `WorkflowDefinition<SpecificInput>` (for type-safe handlers) and register
 * it through {@link asWorkflowDefinition}, which erases the input generic — the
 * engine only ever handles the input as `unknown` (it is parsed via the
 * definition's own `inputSchema` at the boundary).
 */
export type AnyWorkflowDefinition = WorkflowDefinition<unknown>;

export function asWorkflowDefinition<Input>(
  def: WorkflowDefinition<Input>,
): AnyWorkflowDefinition {
  // Safe: the engine parses `input` with `def.inputSchema` before any handler
  // sees it, and passes the parsed value straight back — the generic is only an
  // authoring convenience, erased identically at runtime.
  return def as unknown as AnyWorkflowDefinition;
}

export type WorkflowRegistry = Record<string, AnyWorkflowDefinition>;

/** The outcome of running (or attempting) a single stage. */
export type StepOutcome =
  | { kind: "advanced"; status: WorkflowStatus }
  | { kind: "completed" }
  | { kind: "retry"; backoffMs: number; error: WorkflowError }
  | { kind: "failed"; error: WorkflowError }
  | { kind: "locked" }
  | { kind: "terminal"; status: WorkflowStatus };

/** The result of driving a workflow across (potentially) many stages. */
export interface DriveResult {
  finalStatus: WorkflowStatus;
  stagesRun: number;
  /** True when the drive stopped early (crash simulation / maxStages), not terminal. */
  stopped: boolean;
  lastError?: WorkflowError;
}

export interface RunToCompletionOptions {
  /** Sleep between a retry back-off and the next attempt (default: real timer). */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Called BEFORE each stage with the count already completed on this drive;
   * return false to STOP (simulating a crash/deploy). The workflow is left
   * resumable. When omitted the drive continues until terminal.
   */
  shouldContinue?: (completed: number) => boolean;
  /** Hard cap on stages to run on this drive (crash simulation). */
  maxStages?: number;
  /** Lease owner token for this drive (defaults to a random uuid). */
  leaseOwner?: string;
}

export interface WorkflowEngineDeps {
  repo: WorkflowRepository;
  registry: WorkflowRegistry;
  /** Visibility-timeout for a claimed stage. Default 60s. */
  leaseMs?: number;
  now?: () => Date;
}

const DEFAULT_LEASE_MS = 60_000;

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createWorkflowEngine(deps: WorkflowEngineDeps) {
  const { repo, registry } = deps;
  const leaseMs = deps.leaseMs ?? DEFAULT_LEASE_MS;
  const now = deps.now ?? (() => new Date());

  function definitionFor(type: string): WorkflowDefinition {
    const def = registry[type];
    if (!def) {
      throw invalidCommandError({
        safeMessage: "This kind of task is not available.",
        internalDetail: `No workflow definition registered for type "${type}".`,
        stage: "workflow.registry",
      });
    }
    return def;
  }

  /**
   * Run (or skip, or fail) the CURRENT stage of one workflow exactly once. This
   * is the atomic unit the dispatcher calls repeatedly.
   */
  async function runNextStage(
    workflowId: string,
    leaseOwner: string,
  ): Promise<StepOutcome> {
    const claimed = await repo.claim({
      workflowId,
      leaseOwner,
      leaseMs,
      now: now(),
    });
    if (!claimed) {
      const current = await repo.getExecutionById(workflowId);
      if (!current) {
        throw invalidCommandError({
          safeMessage: "That task could not be found.",
          internalDetail: `Workflow ${workflowId} does not exist.`,
          stage: "workflow.claim",
        });
      }
      // Terminal → nothing to drive. Otherwise the lease is held elsewhere.
      return current.status === "completed" ||
        current.status === "failed" ||
        current.status === "cancelled"
        ? { kind: "terminal", status: current.status }
        : { kind: "locked" };
    }

    const def = definitionFor(claimed.type);
    const stages = def.stages;
    const index = stages.findIndex((s) => s.key === claimed.currentStage);
    if (index === -1) {
      const error = toWorkflowError(
        new DomainError({
          code: "GENERATION_FAILED",
          safeMessage: "This task cannot continue and was stopped safely.",
          internalDetail: `Unknown stage "${claimed.currentStage}" for workflow type "${claimed.type}".`,
          stage: "workflow.stage",
        }),
        now(),
      );
      await repo.recordFailure({
        workflowId,
        leaseOwner,
        attempt: claimed.attempt,
        error,
        nextStatus: transitionWorkflowStatus("running", "fail"),
        now: now(),
      });
      return { kind: "failed", error };
    }

    const stage = stages[index];
    const isLast = index === stages.length - 1;
    const nextStage = isLast ? stage.key : stages[index + 1].key;

    // (1) IDEMPOTENCY: a persisted output for this stage means it already ran —
    // advance without re-invoking the handler (covers a crash between persist and
    // advance). This is the "check the stage output before invoking a provider".
    const existing = await repo.getStageOutput(workflowId, stage.key);
    if (existing) {
      const status = transitionWorkflowStatus(
        "running",
        isLast ? "complete" : "yield",
      );
      await repo.advanceStage({
        workflowId,
        leaseOwner,
        nextStage,
        nextStatus: status,
        now: now(),
      });
      return isLast ? { kind: "completed" } : { kind: "advanced", status };
    }

    // (2) Run the handler, then persist output ATOMICALLY with the advance.
    try {
      const result = await stage.run({
        execution: claimed,
        input: claimed.input,
        attempt: claimed.attempt,
        getStageOutput: async (key) =>
          (await repo.getStageOutput(workflowId, key))?.output,
      });
      const status = transitionWorkflowStatus(
        "running",
        isLast ? "complete" : "yield",
      );
      await repo.completeStage({
        workflowId,
        leaseOwner,
        stageKey: stage.key,
        output: result?.output ?? null,
        lineage: result?.lineage,
        attempt: claimed.attempt,
        nextStage,
        nextStatus: status,
        now: now(),
      });
      return isLast ? { kind: "completed" } : { kind: "advanced", status };
    } catch (thrown) {
      // (3) Retry accounting / dead-letter.
      const attemptsMade = claimed.attempt + 1;
      const { retryable } = classifyFailure(thrown);
      const policy = def.retryPolicy ?? DEFAULT_RETRY_POLICY;
      const error = toWorkflowError(thrown, now());

      if (retryable && !isRetryExhausted(attemptsMade, policy)) {
        const backoffMs = computeBackoffMs(attemptsMade, policy);
        await repo.recordRetry({
          workflowId,
          leaseOwner,
          attempt: attemptsMade,
          error,
          nextStatus: transitionWorkflowStatus("running", "retry"),
          nextAttemptAt: new Date(now().getTime() + backoffMs),
          now: now(),
        });
        return { kind: "retry", backoffMs, error };
      }

      await repo.recordFailure({
        workflowId,
        leaseOwner,
        attempt: attemptsMade,
        error,
        nextStatus: transitionWorkflowStatus("running", "fail"),
        now: now(),
      });
      return { kind: "failed", error };
    }
  }

  /**
   * Drive a workflow forward until it is terminal, parked (locked by another
   * drive), or intentionally stopped (crash simulation / `maxStages`). Honours
   * retry back-off between attempts.
   */
  async function runToCompletion(
    workflowId: string,
    options: RunToCompletionOptions = {},
  ): Promise<DriveResult> {
    const sleep = options.sleep ?? realSleep;
    const leaseOwner = options.leaseOwner ?? globalThis.crypto.randomUUID();
    let stagesRun = 0;
    let lastError: WorkflowError | undefined;

    for (;;) {
      if (options.shouldContinue && !options.shouldContinue(stagesRun)) {
        const current = await repo.getExecutionById(workflowId);
        return {
          finalStatus: current?.status ?? "waiting",
          stagesRun,
          stopped: true,
          lastError,
        };
      }
      if (options.maxStages !== undefined && stagesRun >= options.maxStages) {
        const current = await repo.getExecutionById(workflowId);
        return {
          finalStatus: current?.status ?? "waiting",
          stagesRun,
          stopped: true,
          lastError,
        };
      }

      const outcome = await runNextStage(workflowId, leaseOwner);
      switch (outcome.kind) {
        case "advanced":
          stagesRun += 1;
          continue;
        case "completed":
          stagesRun += 1;
          return { finalStatus: "completed", stagesRun, stopped: false };
        case "retry":
          lastError = outcome.error;
          await sleep(outcome.backoffMs);
          continue;
        case "failed":
          return {
            finalStatus: "failed",
            stagesRun,
            stopped: false,
            lastError: outcome.error,
          };
        case "terminal":
          return {
            finalStatus: outcome.status,
            stagesRun,
            stopped: false,
            lastError,
          };
        case "locked":
          return {
            finalStatus: "running",
            stagesRun,
            stopped: true,
            lastError,
          };
      }
    }
  }

  return { runNextStage, runToCompletion };
}

export type WorkflowEngine = ReturnType<typeof createWorkflowEngine>;
