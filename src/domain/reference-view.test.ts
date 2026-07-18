import { describe, expect, it } from "vitest";

import {
  isReferenceView,
  orderByReferenceView,
  REFERENCE_VIEWS,
  type ReferenceView,
} from "./reference-view";

/**
 * Reference-set ordering is a pure function (`docs/03-ai/image-generation.md`):
 * the front portrait is the identity anchor and must always sort first, so a
 * candidate grid and an approved reference set render in a stable, predictable
 * order regardless of the order assets were generated or stored in.
 */
describe("orderByReferenceView", () => {
  it("orders by canonical identity priority, front portrait first", () => {
    const shuffled: Array<{ view: ReferenceView }> = [
      { view: "default-outfit" },
      { view: "front-portrait" },
      { view: "side-view" },
      { view: "three-quarter" },
    ];
    expect(orderByReferenceView(shuffled).map((a) => a.view)).toEqual([
      "front-portrait",
      "three-quarter",
      "side-view",
      "default-outfit",
    ]);
  });

  it("is a stable pure function that does not mutate its input", () => {
    const input: Array<{ view: ReferenceView }> = [
      { view: "expression" },
      { view: "front-portrait" },
    ];
    const copy = [...input];
    orderByReferenceView(input);
    expect(input).toEqual(copy);
  });

  it("keeps the full canonical set intact", () => {
    const all = REFERENCE_VIEWS.map((view) => ({ view }));
    expect(orderByReferenceView(all).map((a) => a.view)).toEqual([
      ...REFERENCE_VIEWS,
    ]);
  });
});

describe("isReferenceView", () => {
  it("accepts canonical views and rejects anything else", () => {
    expect(isReferenceView("front-portrait")).toBe(true);
    expect(isReferenceView("scale-comparison")).toBe(false);
    expect(isReferenceView(42)).toBe(false);
    expect(isReferenceView(undefined)).toBe(false);
  });
});
