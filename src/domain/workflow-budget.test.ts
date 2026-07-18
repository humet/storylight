import { describe, expect, it } from "vitest";

import {
  consumeTextCall,
  EMPTY_LEDGER,
  textCallBreach,
  type WorkflowBudget,
} from "./workflow-budget";

const BUDGET: WorkflowBudget = {
  maximumTextCalls: 2,
  maximumImageCalls: 0,
  maximumOutputTokens: 1000,
  maximumEstimatedCostMinorUnits: 500,
};

describe("textCallBreach", () => {
  it("allows a call within all ceilings", () => {
    expect(textCallBreach(EMPTY_LEDGER, BUDGET)).toBeNull();
  });

  it("breaches on the call-count ceiling", () => {
    const ledger = { ...EMPTY_LEDGER, textCalls: 2 };
    expect(textCallBreach(ledger, BUDGET)).toBe("text-calls");
  });

  it("breaches on the output-token ceiling", () => {
    const ledger = { ...EMPTY_LEDGER, outputTokens: 1000 };
    expect(textCallBreach(ledger, BUDGET)).toBe("output-tokens");
  });

  it("breaches on the estimated-cost ceiling", () => {
    const ledger = { ...EMPTY_LEDGER, estimatedCostMinorUnits: 500 };
    expect(textCallBreach(ledger, BUDGET)).toBe("estimated-cost");
  });
});

describe("consumeTextCall", () => {
  it("accumulates calls, output tokens, and cost", () => {
    const after = consumeTextCall(
      EMPTY_LEDGER,
      { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      42,
    );
    expect(after).toEqual({
      textCalls: 1,
      imageCalls: 0,
      outputTokens: 20,
      estimatedCostMinorUnits: 42,
    });
  });
});
