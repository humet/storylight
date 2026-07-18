import { describe, expect, it } from "vitest";

import {
  classifyVerdict,
  decideImageReview,
  nextPhase,
  type ImagePhase,
  type VisionVerdict,
} from "./image-job";

/**
 * The review policy is where rule 7 lives: WRONG CHILD IDENTITY or WRONG COUNT is
 * a BLOCKING image failure that the policy can NEVER approve, at any phase.
 */

const clean = (): VisionVerdict => ({
  identityByChild: [{ characterKey: "rosa", matches: true }],
  expectedCount: 1,
  observedCount: 1,
  outfitConsistent: true,
  propConsistent: true,
  toneAppropriate: true,
  styleConsistent: true,
});

describe("classifyVerdict", () => {
  it("marks a fully-passing verdict acceptable and non-blocking", () => {
    const c = classifyVerdict(clean());
    expect(c.acceptable).toBe(true);
    expect(c.blocking).toBe(false);
  });

  it("treats a child identity mismatch as BLOCKING and not acceptable", () => {
    const c = classifyVerdict({
      ...clean(),
      identityByChild: [{ characterKey: "rosa", matches: false }],
    });
    expect(c.blocking).toBe(true);
    expect(c.acceptable).toBe(false);
    expect(c.reasons.join(" ")).toContain("wrong identity");
  });

  it("treats a character count mismatch as BLOCKING and not acceptable", () => {
    const c = classifyVerdict({ ...clean(), observedCount: 2 });
    expect(c.blocking).toBe(true);
    expect(c.acceptable).toBe(false);
    expect(c.reasons.join(" ")).toContain("wrong character count");
  });

  it("treats outfit/tone/style problems as non-blocking but not acceptable", () => {
    const c = classifyVerdict({ ...clean(), outfitConsistent: false });
    expect(c.blocking).toBe(false);
    expect(c.acceptable).toBe(false);
  });
});

describe("decideImageReview", () => {
  it("approves a clean verdict at any phase", () => {
    for (const phase of ["initial", "repair", "escalation"] as ImagePhase[]) {
      expect(decideImageReview({ verdict: clean(), phase }).kind).toBe(
        "approve",
      );
    }
  });

  it("walks the EXACT budget ladder for a non-blocking failure", () => {
    const verdict = { ...clean(), styleConsistent: false };
    expect(decideImageReview({ verdict, phase: "initial" }).kind).toBe(
      "repair",
    );
    expect(decideImageReview({ verdict, phase: "repair" }).kind).toBe(
      "escalate",
    );
    expect(decideImageReview({ verdict, phase: "escalation" }).kind).toBe(
      "manual",
    );
  });

  it("NEVER approves a blocking identity failure, even when the budget is exhausted", () => {
    const badIdentity: VisionVerdict = {
      ...clean(),
      identityByChild: [{ characterKey: "rosa", matches: false }],
    };
    expect(
      decideImageReview({ verdict: badIdentity, phase: "initial" }).kind,
    ).toBe("repair");
    expect(
      decideImageReview({ verdict: badIdentity, phase: "repair" }).kind,
    ).toBe("escalate");
    // Budget exhausted → manual review / pending, NEVER approve.
    expect(
      decideImageReview({ verdict: badIdentity, phase: "escalation" }).kind,
    ).toBe("manual");
  });

  it("NEVER approves a wrong-count failure at any phase", () => {
    const badCount = { ...clean(), observedCount: 3 };
    for (const phase of ["initial", "repair", "escalation"] as ImagePhase[]) {
      expect(decideImageReview({ verdict: badCount, phase }).kind).not.toBe(
        "approve",
      );
    }
  });
});

describe("nextPhase", () => {
  it("advances initial → repair → escalation → null", () => {
    expect(nextPhase("initial")).toBe("repair");
    expect(nextPhase("repair")).toBe("escalation");
    expect(nextPhase("escalation")).toBeNull();
  });
});
