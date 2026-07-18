import type { TokenUsage } from "@/domain/generation-run";

/**
 * A versioned PRICING REGISTRY (`docs/03-ai/models.md` "Pricing",
 * `docs/06-engineering/cost-management.md`). Pricing lives OUTSIDE workflow code
 * and is versioned by effective date so historical generation costs are never
 * recalculated with current prices ("Historical pricing"). Estimated cost feeds
 * the workflow budget and the per-run cost record; it is not a billing source of
 * truth.
 *
 * Rates are MINOR UNITS (US cents) per 1,000,000 tokens. Unknown targets fall
 * back to a conservative rate so a cheap-but-unpriced model can never appear
 * artificially free (`cost-management.md` acceptance criteria).
 */

interface PriceRate {
  /** Cents per 1e6 input tokens. */
  inputPerMillion: number;
  /** Cents per 1e6 output tokens. */
  outputPerMillion: number;
}

interface PriceRecord extends PriceRate {
  target: string;
  /** ISO date this rate became effective. */
  effectiveFrom: string;
}

/** Conservative default when a target has no recorded rate. */
const DEFAULT_RATE: PriceRate = {
  inputPerMillion: 1500,
  outputPerMillion: 7500,
};

/**
 * Effective-dated rate records (most-recent-first per target). Approximate list
 * prices captured at M6 implementation time; refined by the M10 pricing tooling.
 */
const PRICE_RECORDS: PriceRecord[] = [
  {
    target: "anthropic/claude-opus-4.8",
    inputPerMillion: 1500,
    outputPerMillion: 7500,
    effectiveFrom: "2026-07-01",
  },
  {
    target: "anthropic/claude-sonnet-5",
    inputPerMillion: 300,
    outputPerMillion: 1500,
    effectiveFrom: "2026-07-01",
  },
  {
    target: "anthropic/claude-sonnet-4.6",
    inputPerMillion: 300,
    outputPerMillion: 1500,
    effectiveFrom: "2026-07-01",
  },
  {
    target: "anthropic/claude-haiku-4.5",
    inputPerMillion: 100,
    outputPerMillion: 500,
    effectiveFrom: "2026-07-01",
  },
  {
    target: "google/gemini-3.5-flash",
    inputPerMillion: 30,
    outputPerMillion: 250,
    effectiveFrom: "2026-07-01",
  },
  {
    target: "google/gemini-3.1-flash-lite",
    inputPerMillion: 10,
    outputPerMillion: 40,
    effectiveFrom: "2026-07-01",
  },
];

export interface ModelPricing {
  /** Integer minor-unit (cent) cost of one call's usage against a target. */
  estimateCostMinorUnits(target: string, usage: TokenUsage, at?: Date): number;
}

function resolveRate(target: string, at: Date): PriceRate {
  const applicable = PRICE_RECORDS.filter(
    (r) => r.target === target && new Date(r.effectiveFrom) <= at,
  ).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
  return applicable[0] ?? DEFAULT_RATE;
}

export function createModelPricing(): ModelPricing {
  return {
    estimateCostMinorUnits(target, usage, at = new Date()) {
      const rate = resolveRate(target, at);
      const cents =
        (usage.inputTokens * rate.inputPerMillion +
          usage.outputTokens * rate.outputPerMillion) /
        1_000_000;
      // Round UP: a fractional cent of cost never rounds away to zero.
      return Math.ceil(cents);
    },
  };
}
