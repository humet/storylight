import { invalidCommandError } from "@/lib/errors";
import type { CharacterStatus } from "./character";

/**
 * Character lifecycle transitions as a pure, total function
 * (`docs/02-storytelling/character-system.md` "Parent approval"). Kept in the
 * domain with no IO so it is exhaustively unit-testable and reusable by both the
 * repository and the command layer.
 *
 * The only legal moves:
 *  - `approve`: draft → active (a parent approves the profile).
 *  - `retire`: active → retired (a character leaves the rotation).
 *
 * Every other move throws a client-safe `INVALID_COMMAND` domain error rather
 * than silently coercing — an invalid transition is a bug or a stale UI, never
 * something to paper over.
 */
export type CharacterStatusTransition = "approve" | "retire";

const TRANSITIONS: Record<
  CharacterStatusTransition,
  { from: CharacterStatus; to: CharacterStatus }
> = {
  approve: { from: "draft", to: "active" },
  retire: { from: "active", to: "retired" },
};

/**
 * The status a character reaches after applying `transition` to `current`.
 * Throws `INVALID_COMMAND` if the transition is not legal from `current`.
 */
export function applyCharacterStatusTransition(
  current: CharacterStatus,
  transition: CharacterStatusTransition,
): CharacterStatus {
  const rule = TRANSITIONS[transition];
  if (current !== rule.from) {
    throw invalidCommandError({
      safeMessage:
        transition === "approve"
          ? "Only a draft character can be approved."
          : "Only an active character can be retired.",
      internalDetail: `Illegal character transition "${transition}" from status "${current}" (requires "${rule.from}").`,
      stage: "character.status",
    });
  }
  return rule.to;
}
