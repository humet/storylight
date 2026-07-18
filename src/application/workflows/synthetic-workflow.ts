import { z } from "zod";

import type {
  StageContext,
  StageResult,
  WorkflowDefinition,
} from "../workflow-engine";

/**
 * A SYNTHETIC three-stage workflow used to prove the engine end-to-end (the M5
 * exit criterion: "a synthetic multi-stage job survives interruption and resumes
 * without duplicate work"). Each stage writes a marker output; the interruption
 * test counts how many times each handler is invoked to prove no stage re-runs
 * on resume.
 *
 * It is deliberately parameterisable so the SAME definition serves three roles:
 *  - the production registry's dev-only trigger (plain markers);
 *  - the resume test (inject an `onStage` counter);
 *  - the retry / dead-letter tests (inject a `behaviour` that throws).
 */

export const SYNTHETIC_WORKFLOW_TYPE = "synthetic-demo";

export const SyntheticInputSchema = z.object({
  /** A label carried through so a caller can correlate their run. */
  label: z.string().max(120).optional(),
});
export type SyntheticInput = z.infer<typeof SyntheticInputSchema>;

export const SYNTHETIC_STAGE_KEYS = ["prepare", "assemble", "finish"] as const;
export type SyntheticStageKey = (typeof SYNTHETIC_STAGE_KEYS)[number];

/** Per-stage behaviour a test can inject to exercise retry / dead-letter paths. */
export type StageBehaviour = (
  ctx: StageContext,
) => Promise<StageResult | void> | StageResult | void;

export interface SyntheticWorkflowOptions {
  /**
   * Invoked whenever a stage HANDLER actually runs (not on an idempotent skip),
   * so a test can count real invocations. This is our stand-in for "count
   * provider-call invocations".
   */
  onStage?: (stageKey: SyntheticStageKey, ctx: StageContext) => void;
  /** Override a stage's behaviour (e.g. throw a retryable/non-retryable error). */
  behaviour?: Partial<Record<SyntheticStageKey, StageBehaviour>>;
}

const STAGE_LABELS: Record<SyntheticStageKey, string> = {
  prepare: "Getting things ready",
  assemble: "Putting it together",
  finish: "Finishing up",
};

export function createSyntheticWorkflowDefinition(
  options: SyntheticWorkflowOptions = {},
): WorkflowDefinition<SyntheticInput> {
  const stage = (key: SyntheticStageKey) => ({
    key,
    label: STAGE_LABELS[key],
    run: async (ctx: StageContext): Promise<StageResult> => {
      options.onStage?.(key, ctx);
      const override = options.behaviour?.[key];
      if (override) {
        const result = await override(ctx);
        return result ?? { output: { stage: key, marker: `${key}-done` } };
      }
      return { output: { stage: key, marker: `${key}-done`, at: Date.now() } };
    },
  });

  return {
    type: SYNTHETIC_WORKFLOW_TYPE,
    capability: "story:create",
    inputSchema: SyntheticInputSchema,
    pendingLabel: "Getting things ready",
    stages: SYNTHETIC_STAGE_KEYS.map(stage),
  };
}
