import { describe, expect, it } from "vitest";

import {
  crossReferenceChapterDraft,
  crossReferenceIllustrationPlan,
  crossReferenceOneOffPlan,
  normaliseIllustrationPlan,
  normaliseOneOffPlan,
  validateOneOffPlan,
  type OneOffPlanWireLike,
} from "./one-off-artifacts";
import { deriveStoryDna, type StoryDna } from "./story-dna";

const DNA: StoryDna = deriveStoryDna({
  length: "short",
  tone: "gentle",
  characters: [{ id: "c1", name: "Rosa", apparentAge: 6 }],
  safety: {
    readingAge: "5-7",
    maxSuspense: "mild",
    allowMildPeril: true,
    allowDeathGrief: false,
    excludedTopics: [],
  },
});

function planWire(
  overrides: Partial<OneOffPlanWireLike> = {},
): OneOffPlanWireLike {
  return {
    schemaVersion: "one-off-plan.v1",
    title: "The Lantern",
    setting: "A garden",
    protagonistKey: "rosa",
    protagonistDesire: "to get home",
    obstacle: "the dark",
    emotionalTheme: "courage",
    beats: [
      { key: "beat-1", description: "a" },
      { key: "beat-2", description: "b" },
      { key: "beat-3", description: "c" },
      { key: "beat-4", description: "d" },
      { key: "beat-5", description: "e" },
      { key: "beat-6", description: "f" },
    ],
    climax: "x",
    resolution: "y",
    calmingClose: "z",
    ...overrides,
  };
}

describe("crossReferenceOneOffPlan", () => {
  it("accepts a plan whose protagonist is in the cast", () => {
    expect(() => crossReferenceOneOffPlan(planWire(), DNA)).not.toThrow();
  });

  it("rejects a protagonist not in the cast", () => {
    expect(() =>
      crossReferenceOneOffPlan(planWire({ protagonistKey: "nobody" }), DNA),
    ).toThrow();
  });

  it("rejects duplicate beat keys", () => {
    expect(() =>
      crossReferenceOneOffPlan(
        planWire({
          beats: [
            { key: "beat-1", description: "a" },
            { key: "beat-1", description: "b" },
            { key: "beat-3", description: "c" },
            { key: "beat-4", description: "d" },
            { key: "beat-5", description: "e" },
            { key: "beat-6", description: "f" },
          ],
        }),
        DNA,
      ),
    ).toThrow();
  });
});

describe("validateOneOffPlan", () => {
  it("rejects a beat count outside the DNA band", () => {
    const plan = normaliseOneOffPlan(
      planWire({
        beats: Array.from({ length: 10 }, (_v, i) => ({
          key: `beat-${i}`,
          description: "x",
        })),
      }),
    );
    // short-story band is 6–7; ten beats is out of range.
    expect(() => validateOneOffPlan(plan, DNA)).toThrow();
  });
});

describe("crossReferenceChapterDraft", () => {
  it("rejects duplicate anchor keys", () => {
    expect(() =>
      crossReferenceChapterDraft({
        schemaVersion: "chapter-draft.v1",
        title: "t",
        paragraphs: ["a", "b", "c"],
        beatsCovered: [
          "beat-1",
          "beat-2",
          "beat-3",
          "beat-4",
          "beat-5",
          "beat-6",
        ],
        illustrationAnchors: [
          { key: "a", afterParagraph: 0, description: "x" },
          { key: "a", afterParagraph: 1, description: "y" },
        ],
      }),
    ).toThrow();
  });
});

describe("crossReferenceIllustrationPlan", () => {
  it("rejects an illustration referencing an unknown anchor", () => {
    expect(() =>
      crossReferenceIllustrationPlan(
        {
          schemaVersion: "illustration-plan.v1",
          illustrations: [
            {
              anchorKey: "ghost",
              caption: "c",
              sceneDescription: "s",
              aspect: "portrait",
            },
          ],
        },
        ["anchor-1"],
      ),
    ).toThrow();
  });

  it("rejects a duplicate companion key within one scene (ADR-008 part 3)", () => {
    expect(() =>
      crossReferenceIllustrationPlan(
        {
          schemaVersion: "illustration-plan.v2",
          illustrations: [
            {
              anchorKey: "anchor-1",
              caption: "c",
              sceneDescription: "s",
              aspect: "portrait",
              companions: [
                { key: "pip", species: "owl", appearance: "grey" },
                { key: "pip", species: "cat", appearance: "black" },
              ],
            },
          ],
        },
        ["anchor-1"],
      ),
    ).toThrow();
  });

  it("accepts distinct companion keys", () => {
    expect(() =>
      crossReferenceIllustrationPlan(
        {
          schemaVersion: "illustration-plan.v2",
          illustrations: [
            {
              anchorKey: "anchor-1",
              caption: "c",
              sceneDescription: "s",
              aspect: "portrait",
              companions: [
                { key: "pip", species: "owl", appearance: "grey" },
                { key: "nib", species: "cat", appearance: "black" },
              ],
            },
          ],
        },
        ["anchor-1"],
      ),
    ).not.toThrow();
  });
});

describe("crossReferenceIllustrationPlan wardrobe (ADR-008 part 2)", () => {
  it("rejects a scene referencing an undeclared wardrobe state", () => {
    expect(() =>
      crossReferenceIllustrationPlan(
        {
          schemaVersion: "illustration-plan.v3",
          illustrations: [
            {
              anchorKey: "anchor-1",
              caption: "c",
              sceneDescription: "s",
              aspect: "portrait",
              wardrobe: "pyjamas",
            },
          ],
          // no wardrobeStates declared ⇒ "pyjamas" is undeclared
        },
        ["anchor-1"],
      ),
    ).toThrow();
  });

  it("accepts a scene referencing a declared state or the reserved everyday key", () => {
    expect(() =>
      crossReferenceIllustrationPlan(
        {
          schemaVersion: "illustration-plan.v3",
          illustrations: [
            {
              anchorKey: "anchor-1",
              caption: "c",
              sceneDescription: "s",
              aspect: "portrait",
              wardrobe: "pyjamas",
            },
            {
              anchorKey: "anchor-2",
              caption: "c",
              sceneDescription: "s",
              aspect: "portrait",
              wardrobe: "everyday",
            },
          ],
          wardrobeStates: [{ key: "pyjamas", appearance: "flannel pyjamas" }],
        },
        ["anchor-1", "anchor-2"],
      ),
    ).not.toThrow();
  });

  it("rejects redeclaring the reserved 'everyday' key", () => {
    expect(() =>
      crossReferenceIllustrationPlan(
        {
          schemaVersion: "illustration-plan.v3",
          illustrations: [],
          wardrobeStates: [{ key: "everyday", appearance: "a sweater" }],
        },
        [],
      ),
    ).toThrow();
  });

  it("rejects a duplicate wardrobe state key", () => {
    expect(() =>
      crossReferenceIllustrationPlan(
        {
          schemaVersion: "illustration-plan.v3",
          illustrations: [],
          wardrobeStates: [
            { key: "pyjamas", appearance: "flannel pyjamas" },
            { key: "pyjamas", appearance: "cotton pyjamas" },
          ],
        },
        [],
      ),
    ).toThrow();
  });
});

describe("normaliseIllustrationPlan wardrobe (ADR-008 part 2)", () => {
  it("denormalises identical appearance onto every scene sharing a state", () => {
    const specs = normaliseIllustrationPlan({
      schemaVersion: "illustration-plan.v3",
      illustrations: [
        {
          anchorKey: "a1",
          caption: "c",
          sceneDescription: "s",
          aspect: "landscape",
          wardrobe: "pyjamas",
        },
        {
          anchorKey: "a2",
          caption: "c",
          sceneDescription: "s",
          aspect: "landscape",
          wardrobe: "pyjamas",
        },
      ],
      wardrobeStates: [
        { key: "pyjamas", appearance: "  star-print flannel pyjamas  " },
      ],
    });
    // Both scenes carry the SAME (trimmed) appearance copied from the single
    // story-level declaration — five pyjama scenes get identical pyjamas.
    expect(specs[0].wardrobe).toEqual({
      stateKey: "pyjamas",
      appearance: "star-print flannel pyjamas",
    });
    expect(specs[1].wardrobe).toEqual(specs[0].wardrobe);
  });

  it("resolves everyday / absent to NO wardrobe (safe absence)", () => {
    const specs = normaliseIllustrationPlan({
      schemaVersion: "illustration-plan.v3",
      illustrations: [
        {
          anchorKey: "a1",
          caption: "c",
          sceneDescription: "s",
          aspect: "landscape",
          wardrobe: "everyday",
        },
        {
          anchorKey: "a2",
          caption: "c",
          sceneDescription: "s",
          aspect: "landscape",
        },
      ],
    });
    expect(specs[0].wardrobe).toBeUndefined();
    expect(specs[1].wardrobe).toBeUndefined();
  });
});

describe("normaliseIllustrationPlan (ADR-008 parts 3–4)", () => {
  it("trims + carries companions and setting, and omits them when absent", () => {
    const [withExtras, plain] = normaliseIllustrationPlan({
      schemaVersion: "illustration-plan.v2",
      illustrations: [
        {
          anchorKey: "a1",
          caption: "  c  ",
          sceneDescription: "  s  ",
          aspect: "landscape",
          companions: [
            { key: "pip", species: "  owl  ", appearance: "  grey owlet  " },
          ],
          setting: { location: "  the garden  ", timeOfDay: "night" },
        },
        {
          anchorKey: "a2",
          caption: "c2",
          sceneDescription: "s2",
          aspect: "portrait",
        },
      ],
    });
    expect(withExtras.companions).toEqual([
      { key: "pip", species: "owl", appearance: "grey owlet" },
    ]);
    expect(withExtras.setting).toEqual({
      location: "the garden",
      timeOfDay: "night",
    });
    // A spec with nothing declared round-trips as a pre-ADR-008 spec (safe absence).
    expect(plain.companions).toBeUndefined();
    expect(plain.setting).toBeUndefined();
  });
});
