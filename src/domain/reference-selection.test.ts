import { describe, expect, it } from "vitest";

import {
  selectReferences,
  type SceneReferenceRequest,
} from "./reference-selection";

/**
 * The reference selector is the pure heart of "correct child identity" (rule 7).
 * These tests pin the EXACT 8-step priority order and the structural guarantee
 * that a child's identity reference is NEVER dropped to include scenery.
 */

const fullSet = (key: string) => ({
  characterKey: key,
  prominent: false,
  references: [
    { assetId: `${key}-front`, view: "front-portrait" as const },
    { assetId: `${key}-tq`, view: "three-quarter" as const },
    { assetId: `${key}-side`, view: "side-view" as const },
    { assetId: `${key}-outfit`, view: "default-outfit" as const },
  ],
});

describe("selectReferences", () => {
  it("adds one identity reference (front portrait) per child", () => {
    const request: SceneReferenceRequest = {
      children: [fullSet("rosa"), fullSet("theo")],
      extras: [],
    };
    const selected = selectReferences(request, { maxReferences: 8 });
    const identity = selected.filter((r) => r.slot === "identity");
    expect(identity.map((r) => r.characterKey).sort()).toEqual([
      "rosa",
      "theo",
    ]);
    expect(identity.every((r) => r.view === "front-portrait")).toBe(true);
    // Identity slots come first (priority 1).
    expect(selected[0].slot).toBe("identity");
    expect(selected[1].slot).toBe("identity");
  });

  it("NEVER omits a child's identity to include scenery, even past the budget", () => {
    const request: SceneReferenceRequest = {
      children: [fullSet("a"), fullSet("b"), fullSet("c")],
      extras: [
        { slot: "location", assetId: "loc", label: "forest" },
        { slot: "style", assetId: "style", label: "gouache" },
      ],
    };
    // Budget of 1 is smaller than the 3 mandatory identity refs.
    const selected = selectReferences(request, { maxReferences: 1 });
    const identity = selected.filter((r) => r.slot === "identity");
    // All three identity refs survive; scenery is dropped entirely.
    expect(identity).toHaveLength(3);
    expect(selected.every((r) => r.slot === "identity")).toBe(true);
  });

  it("gives the prominent child a second angle (three-quarter)", () => {
    const rosa = { ...fullSet("rosa"), prominent: true };
    const selected = selectReferences(
      { children: [rosa, fullSet("theo")], extras: [] },
      { maxReferences: 8 },
    );
    const second = selected.find((r) => r.slot === "second-angle");
    expect(second).toBeDefined();
    expect(second?.characterKey).toBe("rosa");
    expect(second?.view).toBe("three-quarter");
    // No second angle for the non-prominent child.
    expect(selected.filter((r) => r.slot === "second-angle")).toHaveLength(1);
  });

  it("adds an outfit reference per child when a distinct one exists", () => {
    const selected = selectReferences(
      { children: [fullSet("rosa")], extras: [] },
      { maxReferences: 8 },
    );
    const outfit = selected.find((r) => r.slot === "outfit");
    expect(outfit?.view).toBe("default-outfit");
  });

  it("orders extras exactly prop → location → style → supporting → decorative", () => {
    const selected = selectReferences(
      {
        children: [],
        extras: [
          { slot: "decorative", assetId: "d", label: "vase" },
          { slot: "style", assetId: "s", label: "gouache" },
          { slot: "prop", assetId: "p", label: "lantern" },
          { slot: "supporting", assetId: "sup", label: "cat" },
          { slot: "location", assetId: "l", label: "garden" },
        ],
      },
      { maxReferences: 8 },
    );
    expect(selected.map((r) => r.slot)).toEqual([
      "prop",
      "location",
      "style",
      "supporting",
      "decorative",
    ]);
  });

  it("caps OPTIONAL references at the remaining budget, keeping the highest priority", () => {
    const rosa = { ...fullSet("rosa"), prominent: true };
    const selected = selectReferences(
      {
        children: [rosa],
        extras: [
          { slot: "location", assetId: "l", label: "garden" },
          { slot: "prop", assetId: "p", label: "lantern" },
        ],
      },
      // 1 identity + room for exactly 2 optional slots.
      { maxReferences: 3 },
    );
    expect(selected).toHaveLength(3);
    expect(selected[0].slot).toBe("identity");
    // Second-angle (priority 2) beats outfit/prop/location.
    expect(selected[1].slot).toBe("second-angle");
    // Next highest optional is the outfit (priority 3) over prop/location.
    expect(selected[2].slot).toBe("outfit");
  });

  it("skips a child that has no reference assets (no identity slot) without failing", () => {
    const selected = selectReferences(
      {
        children: [{ characterKey: "ghost", prominent: true, references: [] }],
        extras: [],
      },
      { maxReferences: 8 },
    );
    expect(selected).toHaveLength(0);
  });
});
