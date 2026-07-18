import type { TokenUsage } from "./generation-run";

/**
 * WORKFLOW BUDGET (`docs/06-engineering/cost-management.md`,
 * `docs/03-ai/orchestration.md` "Budgets"). Every workflow has an explicit
 * budget; the structured-generation pipeline enforces it so a run can never spin
 * the repair ladder into unbounded provider cost. Exceeding the budget fails
 * SAFELY (a safe error code, resumable state), never silently.
 *
 * Pure: the interface plus pure accounting helpers. The pipeline threads a
 * {@link BudgetLedger} through the repair ladder; `wouldExceed` is checked BEFORE
 * each model call and `consume` records the accepted usage afterwards.
 */
export interface WorkflowBudget {
  maximumTextCalls: number;
  maximumImageCalls: number;
  maximumOutputTokens: number;
  maximumEstimatedCostMinorUnits: number;
}

/** Running totals consumed so far against a {@link WorkflowBudget}. */
export interface BudgetLedger {
  textCalls: number;
  imageCalls: number;
  outputTokens: number;
  estimatedCostMinorUnits: number;
}

export const EMPTY_LEDGER: BudgetLedger = {
  textCalls: 0,
  imageCalls: 0,
  outputTokens: 0,
  estimatedCostMinorUnits: 0,
};

/** Why a prospective text call would breach the budget (internal reason). */
export type BudgetBreach =
  "text-calls" | "output-tokens" | "estimated-cost" | null;

/**
 * Whether starting ONE more text call is allowed. Checked before every model
 * call: the call-count ceiling is a hard pre-check; the token/cost ceilings are
 * checked against what has ALREADY been consumed (a single call cannot be
 * pre-priced precisely, so we stop once a ceiling is reached). Returns the
 * breached dimension, or `null` when the call is within budget.
 */
export function textCallBreach(
  ledger: BudgetLedger,
  budget: WorkflowBudget,
): BudgetBreach {
  if (ledger.textCalls >= budget.maximumTextCalls) return "text-calls";
  if (ledger.outputTokens >= budget.maximumOutputTokens) return "output-tokens";
  if (ledger.estimatedCostMinorUnits >= budget.maximumEstimatedCostMinorUnits) {
    return "estimated-cost";
  }
  return null;
}

/** Record a completed text call's usage + cost against the ledger (pure). */
export function consumeTextCall(
  ledger: BudgetLedger,
  usage: TokenUsage,
  estimatedCostMinorUnits: number,
): BudgetLedger {
  return {
    ...ledger,
    textCalls: ledger.textCalls + 1,
    outputTokens: ledger.outputTokens + usage.outputTokens,
    estimatedCostMinorUnits:
      ledger.estimatedCostMinorUnits + estimatedCostMinorUnits,
  };
}

/** Why a prospective IMAGE (generation) call would breach the budget. */
export type ImageBudgetBreach = "image-calls" | "estimated-cost" | null;

/**
 * Whether starting ONE more image GENERATION call is allowed (M10 — the image
 * pipeline previously bounded itself only by the fixed phase count; the budget is
 * now the explicit authority across BOTH pipelines, so a change to the phase
 * ladder can never quietly exceed the per-job image budget). Checked before each
 * generation attempt; the cost ceiling is checked against what has ALREADY been
 * spent (a flat per-image cost cannot be pre-priced beyond the call ceiling).
 */
export function imageCallBreach(
  ledger: BudgetLedger,
  budget: WorkflowBudget,
): ImageBudgetBreach {
  if (ledger.imageCalls >= budget.maximumImageCalls) return "image-calls";
  if (ledger.estimatedCostMinorUnits >= budget.maximumEstimatedCostMinorUnits) {
    return "estimated-cost";
  }
  return null;
}

/** Record a completed image (generation) call + its flat cost (pure). */
export function consumeImageCall(
  ledger: BudgetLedger,
  estimatedCostMinorUnits: number,
): BudgetLedger {
  return {
    ...ledger,
    imageCalls: ledger.imageCalls + 1,
    estimatedCostMinorUnits:
      ledger.estimatedCostMinorUnits + estimatedCostMinorUnits,
  };
}
