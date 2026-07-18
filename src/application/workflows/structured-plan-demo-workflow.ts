import { z } from "zod";

import {
  assignSyntheticPlanIds,
  crossReferenceSyntheticPlan,
  normaliseSyntheticPlan,
  validateSyntheticPlan,
  type SyntheticPlan,
} from "@/domain/synthetic-plan";
import type { WorkflowBudget } from "@/domain/workflow-budget";
import type { GenerationRunRepository } from "../ports/generation-run-repository";
import { syntheticPlanningPrompt } from "../prompts/synthetic-planning.prompt";
import {
  syntheticPlanWireSchema,
  type SyntheticPlanWire,
} from "../schemas/synthetic-plan.schema";
import type { StructuredGenerator } from "../ai/generate-structured";
import type { StageResult, WorkflowDefinition } from "../workflow-engine";

/**
 * The M6 EXIT-DEMONSTRATION workflow: a synthetic single-stage workflow whose
 * stage requests a structured artifact through the FULL pipeline
 * (`docs/IMPLEMENTATION_PLAN.md` M6 exit: "test model outputs flow through parse,
 * normalise, domain validate, and persist"). It exercises, on the real engine
 * with a fake language adapter:
 *
 *   language model → SDK parse → wire-schema validate → normalise → cross-reference
 *   validate → domain validate → assign app ids → persist to generation_runs +
 *   generation_artifacts, with lineage on the stage output.
 *
 * The stage is IDEMPOTENT (the M5 contract): the artifact ids are derived from
 * `(workflowId, stageKey)` and the run/artifact rows are recorded idempotently, so
 * a crash-and-retry before the stage output persisted re-produces the same rows.
 */

export const STRUCTURED_PLAN_DEMO_TYPE = "structured-plan-demo";

/**
 * The closed vocabulary of supported age bands. `ageBand` is parent-supplied and
 * flows into canonical context, so it is enum-constrained at this input boundary
 * rather than left as free text (`global-policy.ts` CANONICAL-CONTEXT RULE):
 * canonical values must be enum-constrained or escaped, never both trusted and
 * unbounded.
 */
export const AGE_BANDS = ["0-2", "3-4", "5-7", "8-10"] as const;

export const StructuredPlanDemoInputSchema = z.object({
  /** The parent's untrusted free-text story idea. */
  idea: z.string().min(1).max(500),
  ageBand: z.enum(AGE_BANDS).optional(),
  maxBeats: z.number().int().min(1).max(12).optional(),
});
export type StructuredPlanDemoInput = z.infer<
  typeof StructuredPlanDemoInputSchema
>;

/** A conservative default budget for the demo (`cost-management.md`). */
const DEMO_BUDGET: WorkflowBudget = {
  maximumTextCalls: 4,
  maximumImageCalls: 0,
  maximumOutputTokens: 40_000,
  maximumEstimatedCostMinorUnits: 5_000,
};

export interface StructuredPlanDemoDeps {
  structuredGenerator: StructuredGenerator;
  generationRunRepository: GenerationRunRepository;
}

export function createStructuredPlanDemoWorkflow(
  deps: StructuredPlanDemoDeps,
): WorkflowDefinition<StructuredPlanDemoInput> {
  return {
    type: STRUCTURED_PLAN_DEMO_TYPE,
    capability: "story:create",
    inputSchema: StructuredPlanDemoInputSchema,
    pendingLabel: "Sketching the plan",
    stages: [
      {
        key: "plan",
        label: "Sketching the plan",
        run: async (ctx): Promise<StageResult> => {
          const { execution, stageKey } = ctx;
          const input = ctx.input as StructuredPlanDemoInput;

          const outcome = await deps.structuredGenerator.generate<
            SyntheticPlanWire,
            SyntheticPlan,
            { ageBand: string; maxBeats: number },
            { idea: string }
          >({
            capability: "one-off-planning",
            prompt: syntheticPlanningPrompt,
            wireSchema: syntheticPlanWireSchema,
            canonicalContext: {
              ageBand: input.ageBand ?? "5-7",
              maxBeats: input.maxBeats ?? 12,
            },
            untrustedInput: { idea: input.idea },
            normalise: normaliseSyntheticPlan,
            crossReferenceValidate: crossReferenceSyntheticPlan,
            domainValidate: validateSyntheticPlan,
            budget: DEMO_BUDGET,
          });

          if (!outcome.ok) {
            // Record the failed attempt lineage for observability, then throw the
            // SAFE error — the engine retries / dead-letters per its policy.
            await deps.generationRunRepository.recordGeneration({
              workflowId: execution.id,
              stageKey,
              familyId: execution.familyId,
              capability: "one-off-planning",
              attempts: outcome.attempts,
            });
            throw outcome.error;
          }

          // Map local keys → application-generated ids (deterministic per stage).
          const artifact = await assignSyntheticPlanIds(outcome.artifact, {
            workflowId: execution.id,
            stageKey,
          });

          const acceptedAttemptIndex = outcome.attempts.find((a) =>
            a.outcome === "accepted" ||
            a.outcome === "repaired" ||
            a.outcome === "regenerated"
              ? true
              : false,
          )?.attemptIndex;

          await deps.generationRunRepository.recordGeneration({
            workflowId: execution.id,
            stageKey,
            familyId: execution.familyId,
            capability: "one-off-planning",
            attempts: outcome.attempts,
            artifact: {
              schemaVersion: outcome.schemaVersion,
              kind: "synthetic-plan",
              payload: artifact,
            },
            acceptedAttemptIndex,
          });

          return {
            output: {
              title: artifact.title,
              beatCount: artifact.beatCount,
              outcome: outcome.outcome,
            },
            lineage: {
              promptVersion: outcome.promptVersion,
              schemaVersion: outcome.schemaVersion,
              modelRouteVersion: outcome.routeVersionId,
              usage: outcome.usage,
              latencyMs: outcome.latencyMs,
            },
          };
        },
      },
    ],
  };
}
