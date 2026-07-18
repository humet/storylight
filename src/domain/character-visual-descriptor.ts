import type { CharacterProfile } from "./character";

/**
 * A MODEL-NEUTRAL visual descriptor of a character (`docs/03-ai/image-generation.md`).
 * It is deliberately NOT a provider prompt: application code turns this into a
 * concrete provider prompt inside the image adapter (domain rule 12, ADR-003).
 * Deriving it is a pure function so it is deterministic and testable.
 *
 * The descriptor carries only what a reference render legitimately needs: a
 * stable name, an apparent age band, pronouns, and a few gentle visual motifs
 * drawn from the character's interests. It never leaks the hidden narrative
 * plan, prompts, or provider metadata (domain rule 12).
 */
export interface CharacterVisualDescriptor {
  characterKey: string;
  displayName: string;
  apparentAge: number;
  pronouns: string[];
  /** Gentle visual motifs (from interests) — hints, never a full prompt. */
  motifs: string[];
}

const MAX_MOTIFS = 4;

/** Derive the model-neutral visual descriptor from an approved-or-draft profile. */
export function buildCharacterVisualDescriptor(
  profile: CharacterProfile,
): CharacterVisualDescriptor {
  return {
    characterKey: profile.key,
    displayName: profile.displayName,
    apparentAge: profile.apparentAge,
    pronouns: [...profile.pronouns],
    // Interests make calm visual motifs; cap them so a reference stays uncluttered
    // ("rich but uncluttered backgrounds", `docs/03-ai/image-generation.md`).
    motifs: profile.narrativeIdentity.interests.slice(0, MAX_MOTIFS),
  };
}
