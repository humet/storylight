import { describe, expect, it } from "vitest";

import { createFakeLanguageModel } from "@/adapters/ai/fake-language-model";
import type { LanguageCapability } from "@/domain/model-capability";
import type { ModelRouteVersion } from "@/domain/model-route";
import {
  crossReferenceSyntheticPlan,
  normaliseSyntheticPlan,
  validateSyntheticPlan,
  type SyntheticPlan,
} from "@/domain/synthetic-plan";
import type { WorkflowBudget } from "@/domain/workflow-budget";
import { createModelPricing } from "../model-routes/pricing";
import type { ModelRegistry } from "../model-routes/model-registry";
import { syntheticPlanningPrompt } from "../prompts/synthetic-planning.prompt";
import {
  syntheticPlanWireSchema,
  type SyntheticPlanWire,
} from "../schemas/synthetic-plan.schema";
import { createStructuredGenerator } from "./generate-structured";

/**
 * The M6 REPAIR-LADDER + validation-pipeline tests. Every case runs on the
 * scriptable FAKE language model (no paid calls) so we drive each rung:
 * accepted → syntax repair → one model repair → regenerate → stop at budget, plus
 * availability fallback and cross-reference rejection. This is the heart of the
 * milestone (`docs/03-ai/structured-output.md` "Repair").
 */

const GENEROUS_BUDGET: WorkflowBudget = {
  maximumTextCalls: 6,
  maximumImageCalls: 0,
  maximumOutputTokens: 1_000_000,
  maximumEstimatedCostMinorUnits: 1_000_000,
};

function fakeRegistry(
  capability: LanguageCapability = "one-off-planning",
): ModelRegistry {
  const route: ModelRouteVersion = {
    id: "route-1",
    capability,
    version: "1.0.0",
    primaryTarget: "anthropic/claude-sonnet-5",
    fallbacks: ["anthropic/claude-sonnet-4.6"],
    settings: { temperature: 0.5, maxOutputTokens: 4000 },
    lifecycleStatus: "active",
    evaluationProfile: null,
    approvalRecord: null,
  };
  return {
    async getLanguageRoute() {
      return route;
    },
  };
}

const VALID_PLAN = JSON.stringify({
  schemaVersion: "synthetic-plan.v1",
  title: "The Lantern",
  summary: "A short and gentle tale about a lantern.",
  characters: [{ key: "rosa", name: "Rosa" }],
  beats: [{ key: "beat-1", characterKey: "rosa", action: "finds a lantern" }],
});

const MISSING_TITLE = JSON.stringify({
  schemaVersion: "synthetic-plan.v1",
  summary: "No title on purpose.",
  characters: [{ key: "rosa", name: "Rosa" }],
  beats: [{ key: "beat-1", characterKey: "rosa", action: "does a thing" }],
});

const UNKNOWN_REF = JSON.stringify({
  schemaVersion: "synthetic-plan.v1",
  title: "Bad Ref",
  summary: "A beat points at a character that does not exist.",
  characters: [{ key: "rosa", name: "Rosa" }],
  beats: [{ key: "beat-1", characterKey: "ghost", action: "waves" }],
});

const TRUNCATED = '{"schemaVersion":"synthetic-plan.v1","title":"The Lan';

function makeGenerator(
  languageModel: ReturnType<typeof createFakeLanguageModel>,
  capability: LanguageCapability = "one-off-planning",
) {
  return createStructuredGenerator({
    modelRegistry: fakeRegistry(capability),
    languageModel,
    pricing: createModelPricing(),
  });
}

function request(capability: LanguageCapability = "one-off-planning") {
  return {
    capability,
    prompt: syntheticPlanningPrompt,
    wireSchema: syntheticPlanWireSchema,
    canonicalContext: { ageBand: "5-7", maxBeats: 12 },
    untrustedInput: { idea: "a lantern" },
    normalise: normaliseSyntheticPlan,
    crossReferenceValidate: crossReferenceSyntheticPlan,
    domainValidate: validateSyntheticPlan,
    budget: GENEROUS_BUDGET,
  } as const;
}

async function run(
  script: Parameters<typeof createFakeLanguageModel>[0],
  capability: LanguageCapability = "one-off-planning",
) {
  const generator = makeGenerator(createFakeLanguageModel(script), capability);
  return generator.generate<
    SyntheticPlanWire,
    SyntheticPlan,
    { ageBand: string; maxBeats: number },
    { idea: string }
  >(request(capability));
}

describe("structured-generation pipeline (happy path)", () => {
  it("accepts a valid fixture on the first attempt", async () => {
    const result = await run({ kind: "text", text: VALID_PLAN });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome).toBe("accepted");
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0].outcome).toBe("accepted");
    expect(result.attempts[0].phase).toBe("initial");
    // Normalisation ran (derived beat count) and ids are NOT model-supplied.
    expect((result.artifact as SyntheticPlan).beatCount).toBe(1);
    expect(result.resolvedModelId).toContain("anthropic/claude-sonnet-5");
    expect(result.usage.totalTokens).toBeGreaterThan(0);
  });
});

describe("repair ladder", () => {
  it("SYNTAX-REPAIRS fenced JSON without a second model call", async () => {
    const fenced = "Here is your plan:\n```json\n" + VALID_PLAN + "\n```";
    const result = await run({ kind: "text", text: fenced });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome).toBe("repaired");
    expect(result.attempts).toHaveLength(1); // no extra model call
    expect(result.attempts[0].phase).toBe("syntax-repair");
  });

  it("does ONE MODEL REPAIR for a local schema violation, then accepts", async () => {
    const result = await run([
      { kind: "text", text: MISSING_TITLE },
      { kind: "text", text: VALID_PLAN },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome).toBe("repaired");
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0].outcome).toBe("rejected");
    expect(result.attempts[0].failureKind).toBe("schema-violation");
    expect(result.attempts[1].phase).toBe("model-repair");
    expect(result.attempts[1].outcome).toBe("repaired");
    // Lineage links the repair to the initial attempt.
    expect(result.attempts[1].parentAttemptIndex).toBe(0);
  });

  it("REGENERATES on truncation rather than repairing", async () => {
    const result = await run([
      { kind: "text", text: TRUNCATED, finishReason: "length" },
      { kind: "text", text: VALID_PLAN },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome).toBe("regenerated");
    expect(result.attempts[0].failureKind).toBe("truncated");
    expect(result.attempts[1].phase).toBe("regenerate");
  });

  it("rejects an UNKNOWN REFERENCE then recovers via repair", async () => {
    const result = await run([
      { kind: "text", text: UNKNOWN_REF },
      { kind: "text", text: VALID_PLAN },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.attempts[0].failureKind).toBe("cross-reference");
    expect(result.outcome).toBe("repaired");
  });

  it("continuity-extraction FAVOURS REGENERATION (skips model repair)", async () => {
    const result = await run(
      [
        { kind: "text", text: MISSING_TITLE },
        { kind: "text", text: VALID_PLAN },
      ],
      "continuity-extraction",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A local schema problem would normally be a model repair, but this
    // capability regenerates instead.
    expect(result.attempts[1].phase).toBe("regenerate");
    expect(result.outcome).toBe("regenerated");
  });
});

describe("availability fallbacks", () => {
  it("falls back to the next target on an availability failure", async () => {
    const result = await run([
      { kind: "unavailable" },
      { kind: "text", text: VALID_PLAN },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.attempts[0].failureKind).toBe("unavailable");
    expect(result.attempts[0].target).toBe("anthropic/claude-sonnet-5");
    // The accepted attempt used the fallback target — still "accepted" (a
    // fallback is availability-only and faces identical validation).
    expect(result.attempts[1].target).toBe("anthropic/claude-sonnet-4.6");
    expect(result.outcome).toBe("accepted");
  });

  it("fails RETRYABLY when every target is unavailable", async () => {
    const result = await run({ kind: "unavailable" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failureKind).toBe("unavailable");
    expect(result.error.retryable).toBe(true);
    expect(result.attempts).toHaveLength(2); // primary + one fallback
  });
});

describe("budget enforcement", () => {
  it("stops SAFELY and non-retryably when the text-call budget is exhausted", async () => {
    const generator = makeGenerator(
      createFakeLanguageModel({ kind: "text", text: MISSING_TITLE }),
    );
    const result = await generator.generate<
      SyntheticPlanWire,
      SyntheticPlan,
      { ageBand: string; maxBeats: number },
      { idea: string }
    >({
      ...request(),
      budget: {
        maximumTextCalls: 1,
        maximumImageCalls: 0,
        maximumOutputTokens: 1_000_000,
        maximumEstimatedCostMinorUnits: 1_000_000,
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failureKind).toBe("budget-exceeded");
    // A budget stop must not auto-retry (it would just exhaust again).
    expect(result.error.retryable).toBe(false);
    expect(result.error.code).toBe("GENERATION_FAILED");
    // The one call it did make was recorded, plus the budget-stop row.
    const budgetRow = result.attempts.find(
      (a) => a.failureKind === "budget-exceeded",
    );
    expect(budgetRow?.outcome).toBe("failed");
  });

  it("never lets a raw internal detail reach the safe error message", async () => {
    const result = await run({ kind: "unavailable" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.safeMessage).not.toContain("fake");
    expect(result.error.toClientError().message).not.toContain("fake");
  });
});
