import type { LanguageCapability } from "./model-capability";

/**
 * GENERATION-RUN domain types (`docs/03-ai/structured-output.md`,
 * `docs/06-engineering/cost-management.md`, `docs/03-ai/orchestration.md`
 * "Stage persistence"). Every model call is traceable: one run record per model
 * CALL (attempt), carrying its route/prompt/schema lineage, token usage, latency,
 * outcome, and a parent link so the repair ladder's attempt chain is auditable.
 *
 * Pure types only. The full RAW model output is NEVER placed here or in ordinary
 * logs (`structured-output.md` "Security"); a run may reference the VALIDATED
 * artifact instead.
 */

/** Provider-neutral token accounting for one call. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export const ZERO_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
};

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

/**
 * The repair-ladder phase that PRODUCED an attempt
 * (`docs/03-ai/structured-output.md` "Repair"):
 *  - `initial`      the first generation.
 *  - `syntax-repair` deterministic local JSON extraction (no invented content).
 *  - `model-repair`  ONE model call to fix a local schema problem.
 *  - `regenerate`    a full fresh generation (truncated / structurally wrong).
 */
export type RepairPhase =
  "initial" | "syntax-repair" | "model-repair" | "regenerate";

/** Why a single attempt failed (internal classification; never client-facing). */
export type GenerationFailureKind =
  | "unavailable" // timeout / rate-limit / outage — availability fallback territory
  | "unparsable" // not valid JSON and not locally extractable
  | "truncated" // finished on length / structurally incomplete
  | "schema-violation" // parsed JSON failed wire-schema validation
  | "cross-reference" // referenced an unknown semantic key
  | "domain-invalid" // failed domain validation
  | "budget-exceeded"; // stopped at the workflow budget

/**
 * The recorded OUTCOME of an attempt, mapped from its phase on success or set to
 * `failed`/`rejected` otherwise. Terminal generation outcome = the accepted
 * attempt's outcome, or `failed`.
 */
export type GenerationOutcome =
  | "accepted" // an `initial` attempt validated
  | "repaired" // a `syntax-repair` or `model-repair` attempt validated
  | "regenerated" // a `regenerate` attempt validated
  | "rejected" // this attempt failed validation (a later attempt may recover)
  | "failed"; // terminal failure (no attempt recovered)

/** Map a successful attempt's phase to its recorded outcome. */
export function outcomeForPhase(phase: RepairPhase): GenerationOutcome {
  switch (phase) {
    case "initial":
      return "accepted";
    case "syntax-repair":
    case "model-repair":
      return "repaired";
    case "regenerate":
      return "regenerated";
  }
}

/**
 * One model CALL in a generation, as produced by the pipeline and persisted to
 * `generation_runs`. `parentAttemptIndex` links to the prior attempt so the
 * repair chain is reconstructable. No raw output field by design.
 */
export interface GenerationRunAttempt {
  attemptIndex: number;
  parentAttemptIndex: number | null;
  phase: RepairPhase;
  outcome: GenerationOutcome;
  failureKind?: GenerationFailureKind;
  capability: LanguageCapability;
  modelRouteVersionId: string;
  routeVersion: string;
  /** The gateway slug this attempt targeted (may be a fallback). */
  target: string;
  /** The provider model id the API actually resolved (`models.md` "Stable identifiers"). */
  resolvedModelId: string;
  promptVersion: string;
  schemaVersion: string;
  usage: TokenUsage;
  estimatedCostMinorUnits: number;
  latencyMs: number;
}
