import type {
  GenerationFailureKind,
  GenerationOutcome,
  GenerationRunAttempt,
  RepairPhase,
  TokenUsage,
} from "@/domain/generation-run";
import { addUsage, outcomeForPhase, ZERO_USAGE } from "@/domain/generation-run";
import {
  extractBalancedJsonObject,
  safeParseJson,
} from "@/domain/json-extraction";
import type { LanguageCapability } from "@/domain/model-capability";
import type { PinnedRouteProfile } from "@/domain/model-route";
import {
  consumeTextCall,
  textCallBreach,
  type WorkflowBudget,
  EMPTY_LEDGER,
  type BudgetLedger,
} from "@/domain/workflow-budget";
import { DomainError } from "@/lib/errors";
import type { ZodError } from "zod";

import { getCapabilityMeta } from "../model-routes/capability-registry";
import type { ModelRegistry } from "../model-routes/model-registry";
import type { ModelPricing } from "../model-routes/pricing";
import type {
  LanguageModel,
  LanguageModelResponse,
} from "../ports/language-model";
import type { PromptAsset } from "../prompts/prompt-asset";
import type { WireSchema } from "../schemas/wire";

/**
 * The STRUCTURED-GENERATION PIPELINE (`docs/03-ai/structured-output.md`). It runs
 * every language model call through the fixed validation pipeline and the BOUNDED
 * repair ladder, records every attempt, and enforces the workflow budget. It is
 * the ONLY way domain code obtains a validated artifact from a model.
 *
 * Pipeline: SDK parse → wire-schema validate → normalise → cross-reference
 * validate → domain validate → (caller persists). Repair ladder: classify → apply
 * SYNTAX repair only when no semantic content is invented (a structural JSON
 * extraction) → ONE model repair for a local schema problem → full REGENERATE when
 * truncated or structurally wrong → stop at the workflow budget. Continuity
 * extraction favours regeneration (its capability repair policy skips model
 * repair).
 *
 * The pipeline does NO database IO: it returns the validated artifact plus the
 * full attempt lineage (usage, cost, resolved model id, latency, outcome), and the
 * caller (a workflow stage) persists the runs + artifact. This keeps the ladder a
 * testable near-pure function whose only IO is the {@link LanguageModel} port.
 */

export interface StructuredGenerationRequest<Wire, Domain, Ctx, Untrusted> {
  capability: LanguageCapability;
  prompt: PromptAsset<Ctx, Untrusted>;
  wireSchema: WireSchema<Wire>;
  canonicalContext: Ctx;
  untrustedInput: Untrusted;
  /** Pure normalisation: validated wire → domain artifact (keys → ids, derived fields). */
  normalise: (wire: Wire) => Domain;
  /** Cross-reference validation on the wire output; throw to reject unknown refs. */
  crossReferenceValidate?: (wire: Wire) => void;
  /** Domain validation on the normalised artifact; throw to reject. */
  domainValidate?: (domain: Domain) => void;
  budget: WorkflowBudget;
  /** Series route pins (M8); absent → the active route. */
  pinnedProfile?: PinnedRouteProfile;
}

export interface StructuredGenerationSuccess<Domain> {
  ok: true;
  artifact: Domain;
  /** The validated wire object (not logged raw; available for the caller). */
  wire: unknown;
  outcome: Extract<GenerationOutcome, "accepted" | "repaired" | "regenerated">;
  attempts: GenerationRunAttempt[];
  routeVersionId: string;
  routeVersion: string;
  promptVersion: string;
  schemaVersion: string;
  /** Resolved provider model id of the ACCEPTED attempt. */
  resolvedModelId: string;
  /** Aggregate usage across all attempts. */
  usage: TokenUsage;
  /** Aggregate latency across all attempts. */
  latencyMs: number;
}

export interface StructuredGenerationFailure {
  ok: false;
  failureKind: GenerationFailureKind;
  attempts: GenerationRunAttempt[];
  error: DomainError;
  usage: TokenUsage;
  latencyMs: number;
}

export type StructuredGenerationOutcome<Domain> =
  StructuredGenerationSuccess<Domain> | StructuredGenerationFailure;

export interface StructuredGeneratorDeps {
  modelRegistry: ModelRegistry;
  languageModel: LanguageModel;
  pricing: ModelPricing;
  now?: () => Date;
}

/** The next rung of the repair ladder to apply after a failed attempt. */
type NextRung = "model-repair" | "regenerate" | "stop";

function safeFail(
  failureKind: GenerationFailureKind,
  retryable: boolean,
  internalDetail: string,
): DomainError {
  return new DomainError({
    code: "GENERATION_FAILED",
    safeMessage:
      "We couldn't finish this safely. Nothing was saved, and you can try again.",
    internalDetail,
    retryable,
    stage: `generation:${failureKind}`,
  });
}

/** Compact, invention-free list of Zod issues for a model-repair instruction. */
function describeIssues(error: ZodError): string {
  return error.issues
    .slice(0, 20)
    .map((i) => `- ${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
}

export function createStructuredGenerator(deps: StructuredGeneratorDeps) {
  const { modelRegistry, languageModel, pricing } = deps;
  const now = deps.now ?? (() => new Date());

  return {
    async generate<Wire, Domain, Ctx, Untrusted>(
      request: StructuredGenerationRequest<Wire, Domain, Ctx, Untrusted>,
    ): Promise<StructuredGenerationOutcome<Domain>> {
      const {
        capability,
        prompt,
        wireSchema,
        canonicalContext,
        untrustedInput,
        normalise,
        crossReferenceValidate,
        domainValidate,
        budget,
        pinnedProfile,
      } = request;

      const route = await modelRegistry.getLanguageRoute(
        capability,
        pinnedProfile,
      );
      const targets = [route.primaryTarget, ...route.fallbacks];
      const repairPolicy = getCapabilityMeta(capability).repairPolicy;
      const built = prompt.build({ canonicalContext, untrustedInput });

      const attempts: GenerationRunAttempt[] = [];
      let ledger: BudgetLedger = EMPTY_LEDGER;
      let aggregateUsage: TokenUsage = ZERO_USAGE;
      let aggregateLatency = 0;

      let targetIndex = 0;
      let phase: RepairPhase = "initial";
      let modelRepairUsed = false;
      let repairIssues: string | undefined;

      const record = (
        partial: Omit<
          GenerationRunAttempt,
          "attemptIndex" | "parentAttemptIndex"
        >,
      ): number => {
        const attemptIndex = attempts.length;
        attempts.push({
          ...partial,
          attemptIndex,
          parentAttemptIndex: attemptIndex === 0 ? null : attemptIndex - 1,
        });
        return attemptIndex;
      };

      const failFast = (
        failureKind: GenerationFailureKind,
        retryable: boolean,
        detail: string,
      ): StructuredGenerationFailure => ({
        ok: false,
        failureKind,
        attempts,
        error: safeFail(failureKind, retryable, detail),
        usage: aggregateUsage,
        latencyMs: aggregateLatency,
      });

      for (;;) {
        // Budget pre-check: stop safely before making another call.
        const breach = textCallBreach(ledger, budget);
        if (breach) {
          record({
            phase,
            outcome: "failed",
            failureKind: "budget-exceeded",
            capability,
            modelRouteVersionId: route.id,
            routeVersion: route.version,
            target: targets[targetIndex],
            resolvedModelId: "",
            promptVersion: prompt.version,
            schemaVersion: wireSchema.schemaVersion,
            usage: ZERO_USAGE,
            estimatedCostMinorUnits: 0,
            latencyMs: 0,
          });
          return failFast(
            "budget-exceeded",
            false,
            `Workflow budget exhausted (${breach}) for capability "${capability}".`,
          );
        }

        const target = targets[targetIndex];
        const userPrompt =
          phase === "model-repair" && repairIssues
            ? `${built.prompt}\n\n<repair>\nYour previous response did not match the required schema. Correct ONLY these problems and return the full corrected JSON object. Do not add, remove, or invent any other content:\n${repairIssues}\n</repair>`
            : built.prompt;

        // --- The model call (availability failures reject) ---
        let response: LanguageModelResponse;
        try {
          response = await languageModel.generate({
            target,
            system: built.system,
            prompt: userPrompt,
            schema: wireSchema.schema,
            schemaName: wireSchema.name,
            schemaDescription: wireSchema.description,
            settings: route.settings,
          });
        } catch (thrown) {
          const detail =
            thrown instanceof Error ? thrown.message : String(thrown);
          record({
            phase,
            outcome: "failed",
            failureKind: "unavailable",
            capability,
            modelRouteVersionId: route.id,
            routeVersion: route.version,
            target,
            resolvedModelId: "",
            promptVersion: prompt.version,
            schemaVersion: wireSchema.schemaVersion,
            usage: ZERO_USAGE,
            estimatedCostMinorUnits: 0,
            latencyMs: 0,
          });
          // Availability fallback: try the next target in the SAME phase (a
          // fallback must never bypass validation — it faces the same checks).
          if (targetIndex < targets.length - 1) {
            targetIndex += 1;
            continue;
          }
          return failFast(
            "unavailable",
            true,
            `All ${targets.length} targets for "${capability}" were unavailable: ${detail}`,
          );
        }

        const cost = pricing.estimateCostMinorUnits(
          target,
          response.usage,
          now(),
        );
        ledger = consumeTextCall(ledger, response.usage, cost);
        aggregateUsage = addUsage(aggregateUsage, response.usage);
        aggregateLatency += response.latencyMs;

        // --- Parse (JSON.parse only; structural extraction for syntax repair) ---
        let parsed = safeParseJson(response.text);
        let syntaxRepaired = false;
        if (!parsed.ok) {
          const extracted = extractBalancedJsonObject(response.text);
          if (extracted.ok) {
            parsed = extracted;
            syntaxRepaired = true;
          }
        }

        const finishTruncated = response.finishReason === "length";

        // Classify + decide the next rung after a failed attempt.
        const decideNext = (): NextRung => {
          if (finishTruncated) return "regenerate";
          if (repairPolicy === "full" && !modelRepairUsed)
            return "model-repair";
          return "regenerate";
        };

        const recordRejected = (
          failureKind: GenerationFailureKind,
          usage: TokenUsage,
          latencyMs: number,
        ) => {
          record({
            phase,
            outcome: "rejected",
            failureKind,
            capability,
            modelRouteVersionId: route.id,
            routeVersion: route.version,
            target,
            resolvedModelId: response.resolvedModelId,
            promptVersion: prompt.version,
            schemaVersion: wireSchema.schemaVersion,
            usage,
            estimatedCostMinorUnits: cost,
            latencyMs,
          });
        };

        // Move to the chosen rung: ONE model repair for a local problem, else a
        // full regenerate. `phase` is assigned DIRECTLY (never via a closure) so
        // its type reflects every reachable phase, including "model-repair".
        const toNextPhase = (next: NextRung): RepairPhase => {
          if (next === "model-repair") {
            modelRepairUsed = true;
            return "model-repair";
          }
          return "regenerate";
        };

        if (!parsed.ok) {
          // Not valid JSON and not locally extractable → truncated or garbage.
          const kind: GenerationFailureKind = finishTruncated
            ? "truncated"
            : "unparsable";
          recordRejected(kind, response.usage, response.latencyMs);
          // Unparsable output can only be fixed by regenerating (no content to repair).
          phase = "regenerate";
          continue;
        }

        // --- Wire-schema validation ---
        const wireResult = wireSchema.schema.safeParse(parsed.value);
        if (!wireResult.success) {
          repairIssues = describeIssues(wireResult.error);
          recordRejected(
            "schema-violation",
            response.usage,
            response.latencyMs,
          );
          phase = toNextPhase(decideNext());
          continue;
        }
        const wire = wireResult.data as Wire;

        // --- Cross-reference validation (unknown references are rejected) ---
        try {
          crossReferenceValidate?.(wire);
        } catch (thrown) {
          repairIssues =
            thrown instanceof Error ? `- ${thrown.message}` : String(thrown);
          recordRejected("cross-reference", response.usage, response.latencyMs);
          phase = toNextPhase(decideNext());
          continue;
        }

        // --- Normalise, then domain validation ---
        const artifact = normalise(wire);
        try {
          domainValidate?.(artifact);
        } catch (thrown) {
          repairIssues =
            thrown instanceof Error ? `- ${thrown.message}` : String(thrown);
          recordRejected("domain-invalid", response.usage, response.latencyMs);
          phase = toNextPhase(decideNext());
          continue;
        }

        // --- Accepted ---
        // A structural extraction on the FIRST attempt is a syntax repair; on a
        // later rung the dominant phase (model-repair / regenerate) stands.
        const acceptedPhase: RepairPhase =
          phase === "initial" && syntaxRepaired ? "syntax-repair" : phase;
        record({
          phase: acceptedPhase,
          outcome: outcomeForPhase(acceptedPhase),
          capability,
          modelRouteVersionId: route.id,
          routeVersion: route.version,
          target,
          resolvedModelId: response.resolvedModelId,
          promptVersion: prompt.version,
          schemaVersion: wireSchema.schemaVersion,
          usage: response.usage,
          estimatedCostMinorUnits: cost,
          latencyMs: response.latencyMs,
        });

        return {
          ok: true,
          artifact,
          wire,
          outcome: outcomeForPhase(acceptedPhase) as
            "accepted" | "repaired" | "regenerated",
          attempts,
          routeVersionId: route.id,
          routeVersion: route.version,
          promptVersion: prompt.version,
          schemaVersion: wireSchema.schemaVersion,
          resolvedModelId: response.resolvedModelId,
          usage: aggregateUsage,
          latencyMs: aggregateLatency,
        };
      }
    },
  };
}

export type StructuredGenerator = ReturnType<typeof createStructuredGenerator>;
