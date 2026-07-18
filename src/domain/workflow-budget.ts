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
