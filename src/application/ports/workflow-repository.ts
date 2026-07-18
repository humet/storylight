import type {
  WorkflowError,
  WorkflowExecution,
  WorkflowStatus,
} from "@/domain/workflow";

/**
 * Workflow-persistence PORT — owned by the application layer so the engine and
 * services never depend on Drizzle (domain rule 12). Storylight OWNS its workflow
 * state (ADR-002): this port is the authoritative home of the state machine,
 * stage outputs, idempotency, the lease/visibility-timeout claim, and retry
 * accounting. The Drizzle implementation lives in
 * `src/db/repositories/workflow-repository.ts`; tests run the real repo against
 * PGlite.
 *
 * FAMILY SCOPING: the SERVICE-facing reads take a `familyId` the caller has been
 * authorised for and filter by it — a guessed workflow id from another family
 * resolves to nothing. The ENGINE-facing methods operate by workflow id only
 * (the engine has already been handed a specific workflow to drive) and instead
 * enforce concurrency via the lease.
 */

/** A persisted stage output (`docs/03-ai/orchestration.md` "Stage persistence"). */
export interface StageOutputRecord {
  workflowId: string;
  stageKey: string;
  output: unknown;
  attempt: number;
  promptVersion?: string;
  schemaVersion?: string;
  modelRouteVersion?: string;
  usage?: unknown;
  latencyMs?: number;
  createdAt: Date;
}

/** Lineage recorded alongside a stage output (all optional until M6 model routes). */
export interface StageLineage {
  promptVersion?: string;
  schemaVersion?: string;
  modelRouteVersion?: string;
  usage?: unknown;
  latencyMs?: number;
}

export interface CreateExecutionInput {
  familyId: string;
  userId: string;
  type: string;
  requestId: string;
  entityId?: string;
  input: unknown;
  /** The first stage key (from the workflow definition). */
  initialStage: string;
}

export interface ClaimInput {
  workflowId: string;
  /** Token identifying the dispatcher/drive that will own the lease. */
  leaseOwner: string;
  /** Lease duration in ms (visibility timeout). */
  leaseMs: number;
  now?: Date;
}

/** Atomic "persist stage output AND advance the current stage". */
export interface CompleteStageInput {
  workflowId: string;
  leaseOwner: string;
  stageKey: string;
  output: unknown;
  lineage?: StageLineage;
  attempt: number;
  nextStage: string;
  nextStatus: WorkflowStatus;
  now?: Date;
}

/** Advance without a new output (idempotent skip: the output already exists). */
export interface AdvanceStageInput {
  workflowId: string;
  leaseOwner: string;
  nextStage: string;
  nextStatus: WorkflowStatus;
  now?: Date;
}

export interface RecordRetryInput {
  workflowId: string;
  leaseOwner: string;
  attempt: number;
  error: WorkflowError;
  nextStatus: WorkflowStatus;
  nextAttemptAt: Date;
  now?: Date;
}

export interface RecordFailureInput {
  workflowId: string;
  leaseOwner: string;
  attempt: number;
  error: WorkflowError;
  nextStatus: WorkflowStatus;
  now?: Date;
}

export interface WorkflowRepository {
  /**
   * Idempotent creation keyed by `UNIQUE(user_id, request_id, workflow_type)`
   * (`docs/03-ai/orchestration.md`, `docs/05-backend/database.md`). A duplicate
   * submission resolves to the EXISTING execution (`created: false`) without
   * inserting a second row — the constraint, not an application check, is what
   * makes concurrent duplicate starts safe.
   */
  createOrGetExecution(
    input: CreateExecutionInput,
  ): Promise<{ execution: WorkflowExecution; created: boolean }>;

  /** Family-scoped read for a service/query. Null when not in this family. */
  getExecution(
    familyId: string,
    workflowId: string,
  ): Promise<WorkflowExecution | null>;

  /** Engine-side read by id only (the engine drives a specific workflow). */
  getExecutionById(workflowId: string): Promise<WorkflowExecution | null>;

  /**
   * The most recent execution of `type` for a domain entity in a family (used by
   * the appearance UI to find an in-flight candidate generation). Null when none.
   */
  findLatestByEntity(
    familyId: string,
    type: string,
    entityId: string,
  ): Promise<WorkflowExecution | null>;

  getStageOutput(
    workflowId: string,
    stageKey: string,
  ): Promise<StageOutputRecord | null>;

  listStageOutputs(workflowId: string): Promise<StageOutputRecord[]>;

  /**
   * Atomically CLAIM the workflow to run its next stage: move a `queued` or
   * `waiting` execution to `running` and take the lease, but ONLY when it is not
   * currently held by a live (unexpired) lease. Returns the claimed execution,
   * or null when it is terminal or the lease is held by someone else (the caller
   * then reports locked). This is the concurrency guard: two dispatchers racing
   * to run the same workflow's next stage — exactly one wins the row update.
   * (A dead-lettered `failed` execution is resumed explicitly via `requeue`, not
   * by `claim`.)
   */
  claim(input: ClaimInput): Promise<WorkflowExecution | null>;

  completeStage(input: CompleteStageInput): Promise<void>;

  advanceStage(input: AdvanceStageInput): Promise<void>;

  recordRetry(input: RecordRetryInput): Promise<void>;

  recordFailure(input: RecordFailureInput): Promise<void>;

  /** Cancel where safe (from `queued`/`waiting`). Null if not cancellable. */
  cancel(
    familyId: string,
    workflowId: string,
  ): Promise<WorkflowExecution | null>;

  /** Re-queue a dead-lettered (`failed`) execution. Null if not resumable. */
  requeue(
    familyId: string,
    workflowId: string,
  ): Promise<WorkflowExecution | null>;
}
