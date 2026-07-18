import type {
  GenerationFailureKind,
  GenerationOutcome,
  GenerationRunAttempt,
  RepairPhase,
} from "@/domain/generation-run";
import type { LanguageCapability } from "@/domain/model-capability";

/**
 * PORT for persisting GENERATION RUNS + the validated artifact
 * (`docs/03-ai/structured-output.md`, `docs/06-engineering/cost-management.md`).
 * Owned by the application; the Drizzle impl lives in
 * `src/db/repositories/generation-run-repository.ts`. A workflow stage calls
 * {@link recordGeneration} once, AFTER the pipeline returns, to persist the
 * artifact (if any) and every attempt row.
 *
 * IDEMPOTENT: recording is keyed deterministically by `(workflowId, stageKey[,
 * attemptIndex])` so a crash-and-retry of the stage (before its output persisted)
 * re-records the SAME rows instead of duplicating the audit trail (the M5 stage
 * idempotency contract).
 */

export interface RecordArtifactInput {
  schemaVersion: string;
  kind: string;
  /** The validated, normalised artifact (domain data — never raw model output). */
  payload: unknown;
}

export interface RecordGenerationInput {
  workflowId: string;
  stageKey: string;
  familyId?: string;
  capability: LanguageCapability;
  attempts: GenerationRunAttempt[];
  /** Present on success — the validated artifact to store + reference. */
  artifact?: RecordArtifactInput;
  /** Which attemptIndex produced the artifact (receives the artifact ref). */
  acceptedAttemptIndex?: number;
}

export interface RecordGenerationResult {
  artifactId: string | null;
  runIds: string[];
}

/** A persisted run row (read model for tests / observability). */
export interface GenerationRunRecord {
  id: string;
  workflowId: string | null;
  stageKey: string | null;
  capability: LanguageCapability;
  modelRouteVersionId: string | null;
  routeVersion: string;
  resolvedModelId: string;
  target: string;
  promptVersion: string;
  schemaVersion: string;
  attemptIndex: number;
  parentAttemptIndex: number | null;
  phase: RepairPhase;
  outcome: GenerationOutcome;
  failureKind: GenerationFailureKind | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostMinorUnits: number;
  latencyMs: number;
  artifactRef: string | null;
}

export interface GenerationArtifactRecord {
  id: string;
  workflowId: string | null;
  stageKey: string | null;
  schemaVersion: string;
  kind: string;
  payload: unknown;
}

export interface GenerationRunRepository {
  recordGeneration(
    input: RecordGenerationInput,
  ): Promise<RecordGenerationResult>;

  /** All attempt rows for a workflow, ordered by attempt index. */
  listRunsForWorkflow(workflowId: string): Promise<GenerationRunRecord[]>;

  /** The validated artifact for a (workflow, stage), if any. */
  getArtifact(
    workflowId: string,
    stageKey: string,
  ): Promise<GenerationArtifactRecord | null>;
}
