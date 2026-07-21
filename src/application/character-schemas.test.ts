import { describe, expect, it } from "vitest";

import { CharacterProfilePayloadSchema } from "./character-schemas";

/**
 * The appearance-notes field is the runtime boundary for a parent's free-text
 * physical description (AGENTS.md: "Zod v4 at runtime boundaries"). It must trim,
 * cap to the DB varchar(500), collapse empty/whitespace to `null`, and stay
 * optional so older payload shapes (before this field existed) still validate.
 */

function input(overrides: Record<string, unknown> = {}) {
  return {
    displayName: "Rosa",
    apparentAge: 7,
    pronouns: ["she", "her"],
    narrativeIdentity: {
      personalityTraits: [],
      strengths: [],
      vulnerabilities: [],
      interests: [],
      values: [],
      speechStyle: {
        sentenceLength: "mixed",
        directness: "reflective",
        humourStyle: [],
        vocabularyNotes: [],
        prohibitedPatterns: [],
      },
      behaviourRules: [],
      forbiddenCharacterisations: [],
    },
    fictionalisationPolicy: {
      mayUseMagic: true,
      mayTransformTemporarily: true,
      mayPortrayMildDisagreement: true,
      mayPortrayFear: true,
      mayUseRealFamilyMembers: false,
      mayInventSchoolOrHomeDetails: false,
      excludedThemes: [],
    },
    ...overrides,
  };
}

describe("CharacterProfilePayloadSchema — appearanceNotes", () => {
  it("trims surrounding whitespace", () => {
    const parsed = CharacterProfilePayloadSchema.parse(
      input({ appearanceNotes: "  Curly red hair  " }),
    );
    expect(parsed.appearanceNotes).toBe("Curly red hair");
  });

  it("collapses an empty string to null", () => {
    const parsed = CharacterProfilePayloadSchema.parse(
      input({ appearanceNotes: "" }),
    );
    expect(parsed.appearanceNotes).toBeNull();
  });

  it("collapses a whitespace-only string to null", () => {
    const parsed = CharacterProfilePayloadSchema.parse(
      input({ appearanceNotes: "   " }),
    );
    expect(parsed.appearanceNotes).toBeNull();
  });

  it("defaults a missing field to null (older payload shapes stay valid)", () => {
    const parsed = CharacterProfilePayloadSchema.parse(input());
    expect(parsed.appearanceNotes).toBeNull();
  });

  it("accepts notes at the 500-character cap", () => {
    const parsed = CharacterProfilePayloadSchema.parse(
      input({ appearanceNotes: "x".repeat(500) }),
    );
    expect(parsed.appearanceNotes).toHaveLength(500);
  });

  it("rejects notes longer than 500 characters", () => {
    const result = CharacterProfilePayloadSchema.safeParse(
      input({ appearanceNotes: "x".repeat(501) }),
    );
    expect(result.success).toBe(false);
  });
});
