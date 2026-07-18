import { describe, expect, it } from "vitest";

import {
  crossReferenceChapterDraft,
  crossReferenceIllustrationPlan,
  crossReferenceOneOffPlan,
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
});
