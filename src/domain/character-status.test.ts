import { describe, expect, it } from "vitest";

import { applyCharacterStatusTransition } from "./character-status";
import type { CharacterStatus } from "./character";
import { isDomainError } from "@/lib/errors";

/**
 * The character lifecycle is a pure, total transition function
 * (`docs/02-storytelling/character-system.md`). These tests pin the ONLY two
 * legal moves and prove every other move throws a client-safe domain error —
 * the invariant the approval flow and the repository both rely on.
 */
describe("applyCharacterStatusTransition", () => {
  it("approves a draft into active", () => {
    expect(applyCharacterStatusTransition("draft", "approve")).toBe("active");
  });

  it("retires an active character", () => {
    expect(applyCharacterStatusTransition("active", "retire")).toBe("retired");
  });

  const illegal: Array<[CharacterStatus, "approve" | "retire"]> = [
    ["active", "approve"],
    ["retired", "approve"],
    ["draft", "retire"],
    ["retired", "retire"],
  ];

  it.each(illegal)(
    "rejects %s → %s as an INVALID_COMMAND domain error",
    (from, transition) => {
      try {
        applyCharacterStatusTransition(from, transition);
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
