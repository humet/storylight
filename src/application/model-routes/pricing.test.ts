import { describe, expect, it } from "vitest";

import { createModelPricing } from "./pricing";

const pricing = createModelPricing();
const at = new Date("2026-07-18T00:00:00.000Z");

describe("model pricing", () => {
  it("prices a known model from its input/output rates", () => {
    // sonnet-5: 300 c/1e6 input, 1500 c/1e6 output.
    const cost = pricing.estimateCostMinorUnits(
      "anthropic/claude-sonnet-5",
      {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        totalTokens: 2_000_000,
      },
      at,
    );
    expect(cost).toBe(300 + 1500);
  });

  it("rounds a fractional cent UP so tiny usage is never free", () => {
    const cost = pricing.estimateCostMinorUnits(
      "anthropic/claude-sonnet-5",
      { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      at,
    );
    expect(cost).toBe(1);
  });

  it("falls back to the conservative default for an unknown model", () => {
    const known = pricing.estimateCostMinorUnits(
      "anthropic/claude-haiku-4.5",
      { inputTokens: 1_000_000, outputTokens: 0, totalTokens: 1_000_000 },
      at,
    );
    const unknown = pricing.estimateCostMinorUnits(
      "some/unpriced-model",
      { inputTokens: 1_000_000, outputTokens: 0, totalTokens: 1_000_000 },
      at,
    );
    // A cheap-but-unpriced model must not look artificially cheaper than a
    // priced one (`cost-management.md` acceptance criteria).
    expect(unknown).toBeGreaterThan(known);
  });
});
