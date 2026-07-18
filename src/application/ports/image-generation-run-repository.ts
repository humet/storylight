import type { ImageCapability } from "@/domain/model-capability";

/**
 * IMAGE GENERATION-RUN persistence PORT (`docs/06-engineering/cost-management.md`:
 * "Every provider call has recorded usage"; image generation / image review /
 * image repair / premium escalation are distinct cost units). A PARALLEL spine to
 * the text `generation_runs` — image calls have a different result contract (bytes
 * + verdict, not a validated JSON artifact) and flat per-image pricing, so they get
 * their own table rather than widening the language-only `generation_runs` enum
 * (the M6-note reconciliation, resolved in M9). Recording is IDEMPOTENT, keyed by
 * `(workflowId, stageKey, phase, kind)`.
 */

export type ImageRunKind = "generation" | "review";

export interface RecordImageRunInput {
  workflowId: string;
  stageKey: string;
  familyId?: string;
  storyId?: string;
  specId?: string;
  capability: ImageCapability;
  phase: string;
  kind: ImageRunKind;
  target: string;
  resolvedModelId: string;
  routeVersion: string;
  seed?: number;
  outcome: string;
  failureKind?: string;
  imageCount: number;
  estimatedCostMinorUnits: number;
  latencyMs: number;
}

export interface ImageRunRecord {
  id: string;
  specId: string | null;
  capability: ImageCapability;
  phase: string;
  kind: ImageRunKind;
  outcome: string;
  estimatedCostMinorUnits: number;
  imageCount: number;
}

export interface ImageGenerationRunRepository {
  recordImageRun(input: RecordImageRunInput): Promise<void>;

  /** All image-run rows for a workflow (read model for tests / cost breakdown). */
  listRunsForWorkflow(workflowId: string): Promise<ImageRunRecord[]>;
}
