import { describe, expect, it } from "vitest";

import { isDomainError } from "@/lib/errors";
import type { VisualAssetState } from "./visual-asset";
import {
  applyVisualAssetTransition,
  isDeliverable,
  type VisualAssetTransition,
} from "./visual-asset-state";

/**
 * The visual-asset lifecycle is a pure, total transition function
 * (`docs/05-backend/storage.md`). These tests pin the legal moves and prove
 * every illegal move throws a client-safe domain error — the invariant that
 * only `quarantined` can become `approved`, and only `approved` is deliverable,
 * which the whole "rejected candidates are inaccessible" guarantee rests on.
 */
describe("applyVisualAssetTransition", () => {
  it.each([
    ["quarantined", "approve", "approved"],
    ["quarantined", "reject", "rejected"],
    ["approved", "retire", "retired"],
    ["quarantined", "mark-for-deletion", "deletion-pending"],
    ["approved", "mark-for-deletion", "deletion-pending"],
    ["rejected", "mark-for-deletion", "deletion-pending"],
    ["retired", "mark-for-deletion", "deletion-pending"],
  ] as Array<[VisualAssetState, VisualAssetTransition, VisualAssetState]>)(
    "%s → %s = %s",
    (from, transition, expected) => {
      expect(applyVisualAssetTransition(from, transition)).toBe(expected);
    },
  );

  const illegal: Array<[VisualAssetState, VisualAssetTransition]> = [
    ["approved", "approve"],
    ["rejected", "approve"],
    ["retired", "approve"],
    ["deletion-pending", "approve"],
    ["approved", "reject"],
    ["rejected", "reject"],
    ["quarantined", "retire"],
    ["rejected", "retire"],
    ["deletion-pending", "mark-for-deletion"],
  ];

  it.each(illegal)(
    "rejects %s → %s as an INVALID_COMMAND domain error",
    (from, transition) => {
      try {
        applyVisualAssetTransition(from, transition);
        throw new Error("expected the transition to throw");
      } catch (error) {
        expect(isDomainError(error)).toBe(true);
        if (isDomainError(error)) {
          expect(error.code).toBe("INVALID_COMMAND");
        }
      }
    },
  );
});

describe("isDeliverable", () => {
  it("permits only approved assets", () => {
    expect(isDeliverable("approved")).toBe(true);
    for (const state of [
      "quarantined",
      "rejected",
      "retired",
      "deletion-pending",
    ] as VisualAssetState[]) {
      expect(isDeliverable(state)).toBe(false);
    }
  });
});
