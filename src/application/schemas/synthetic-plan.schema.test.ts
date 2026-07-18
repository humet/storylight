import { describe, expect, it } from "vitest";

import { SEMANTIC_KEY_REGEX } from "./wire";
import { SyntheticPlanArtifactV1 } from "./synthetic-plan.schema";

function validPlan() {
  return {
    schemaVersion: "synthetic-plan.v1",
    title: "The Lantern",
    summary: "A gentle tale.",
    characters: [{ key: "rosa", name: "Rosa" }],
    beats: [{ key: "beat-1", characterKey: "rosa", action: "finds it" }],
  };
}

describe("synthetic plan wire schema (strict, bounded, versioned)", () => {
  it("accepts a valid artifact", () => {
    expect(SyntheticPlanArtifactV1.safeParse(validPlan()).success).toBe(true);
  });

  it("pins the schemaVersion literal", () => {
    const bad = { ...validPlan(), schemaVersion: "synthetic-plan.v2" };
    expect(SyntheticPlanArtifactV1.safeParse(bad).success).toBe(false);
  });

  it("rejects unknown keys (strict object)", () => {
    const bad = { ...validPlan(), sneaky: true };
    expect(SyntheticPlanArtifactV1.safeParse(bad).success).toBe(false);
  });

  it("rejects an unbounded (too-long) string", () => {
    const bad = { ...validPlan(), title: "x".repeat(200) };
    expect(SyntheticPlanArtifactV1.safeParse(bad).success).toBe(false);
  });

  it("rejects an over-length array", () => {
    const bad = {
      ...validPlan(),
      beats: Array.from({ length: 13 }, (_, i) => ({
        key: `beat-${i}`,
        characterKey: "rosa",
        action: "x",
      })),
    };
    expect(SyntheticPlanArtifactV1.safeParse(bad).success).toBe(false);
  });

  it("rejects a semantic key that is not kebab-case (no db ids)", () => {
    const bad = {
      ...validPlan(),
      characters: [{ key: "Rosa_ID", name: "Rosa" }],
    };
    expect(SyntheticPlanArtifactV1.safeParse(bad).success).toBe(false);
  });

  it("the semantic-key regex matches the documented shape", () => {
    expect(SEMANTIC_KEY_REGEX.test("rosa-the-brave")).toBe(true);
    expect(SEMANTIC_KEY_REGEX.test("1nope")).toBe(false);
    expect(SEMANTIC_KEY_REGEX.test("Nope")).toBe(false);
  });
});
