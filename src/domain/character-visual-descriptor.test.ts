import { describe, expect, it } from "vitest";

import type { CharacterProfile } from "./character";
import { buildCharacterVisualDescriptor } from "./character-visual-descriptor";

/**
 * The visual descriptor is a PURE projection of an approved-or-draft profile
 * (`docs/03-ai/image-generation.md`, ADR-003): it copies the parent's own words
 * verbatim, never invents a physical description, and keeps the reference
 * uncluttered by capping interest-derived motifs. These pin that contract so a
 * later refactor cannot start paraphrasing or over-stuffing the descriptor.
 */

function profile(overrides: Partial<CharacterProfile> = {}): CharacterProfile {
  return {
    id: "char-1",
    familyId: "fam-1",
    key: "rosa-abc",
    displayName: "Rosa",
    apparentAge: 7,
    pronouns: ["she", "her"],
    appearanceNotes: null,
    status: "draft",
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
    visualProfileId: null,
    version: 1,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("buildCharacterVisualDescriptor", () => {
  it("copies parent-authored appearance notes verbatim", () => {
    const descriptor = buildCharacterVisualDescriptor(
      profile({
        appearanceNotes: "Curly red hair, round glasses, yellow raincoat",
      }),
    );
    expect(descriptor.appearanceNotes).toBe(
      "Curly red hair, round glasses, yellow raincoat",
    );
  });

  it("carries null appearance notes through when the parent gave none", () => {
    const descriptor = buildCharacterVisualDescriptor(
      profile({ appearanceNotes: null }),
    );
    expect(descriptor.appearanceNotes).toBeNull();
  });

  it("caps interest-derived motifs at four to keep the reference uncluttered", () => {
    const descriptor = buildCharacterVisualDescriptor(
      profile({
        narrativeIdentity: {
          ...profile().narrativeIdentity,
          interests: ["beetles", "maps", "kites", "rivers", "stars", "shells"],
        },
      }),
    );
    expect(descriptor.motifs).toEqual(["beetles", "maps", "kites", "rivers"]);
  });

  it("copies pronouns (a fresh array, not the profile's reference)", () => {
    const source = profile({ pronouns: ["they", "them"] });
    const descriptor = buildCharacterVisualDescriptor(source);
    expect(descriptor.pronouns).toEqual(["they", "them"]);
    expect(descriptor.pronouns).not.toBe(source.pronouns);
  });
});
