import { describe, expect, it } from "vitest";

import { deriveStoryDna, type StoryDna } from "./story-dna";
import {
  countDraftWords,
  validateDraftAgainstPlan,
  wordCountAcceptable,
  type ChapterDraft,
  type OneOffPlan,
} from "./story-draft";
import { isDomainError } from "@/lib/errors";

const DNA: StoryDna = deriveStoryDna({
  length: "short",
  tone: "gentle",
  characters: [{ id: "c1", name: "Rosa", apparentAge: 5 }],
  safety: {
    readingAge: "5-7",
    maxSuspense: "mild",
    allowMildPeril: true,
    allowDeathGrief: false,
    excludedTopics: [],
  },
});

const PLAN: OneOffPlan = {
  title: "The Lantern",
  setting: "A quiet garden at dusk",
  protagonistKey: "rosa",
  protagonistDesire: "to find her way home",
  obstacle: "the dark",
  emotionalTheme: "courage",
  beats: [
    { key: "beat-1", description: "Rosa notices the dark" },
    { key: "beat-2", description: "She finds a lantern" },
    { key: "beat-3", description: "She lights it" },
    { key: "beat-4", description: "She follows the path" },
    { key: "beat-5", description: "She meets a firefly" },
    { key: "beat-6", description: "She reaches home" },
  ],
  climax: "The path forks in the dark",
  resolution: "The firefly shows the way",
  calmingClose: "Rosa drifts to sleep",
};

/** A body sized to land in the short-story band (~432–648, lenient check wider). */
function body(words: number): string[] {
  const sentence = "Rosa walked softly through the glowing garden tonight";
  const per = sentence.split(" ").length; // 8
  const count = Math.ceil(words / per);
  const paragraphs: string[] = [];
  for (let i = 0; i < count; i += 5) {
    paragraphs.push(
      Array.from({ length: Math.min(5, count - i) }, () => sentence).join(" "),
    );
  }
  return paragraphs;
}

function draft(overrides: Partial<ChapterDraft> = {}): ChapterDraft {
  return {
    title: "The Lantern",
    paragraphs: body(500),
    beatsCovered: PLAN.beats.map((b) => b.key),
    anchors: [
      { key: "anchor-1", afterParagraph: 1, description: "The lantern" },
    ],
    ...overrides,
  };
}

describe("countDraftWords", () => {
  it("counts whitespace-delimited words across paragraphs", () => {
    expect(countDraftWords(["one two three", "four five"])).toBe(5);
  });
});

describe("wordCountAcceptable", () => {
  it("accepts within the lenient band and rejects far outside", () => {
    expect(wordCountAcceptable(500, DNA)).toBe(true);
    expect(wordCountAcceptable(50, DNA)).toBe(false);
    expect(wordCountAcceptable(5000, DNA)).toBe(false);
  });
});

describe("validateDraftAgainstPlan", () => {
  it("passes a well-formed draft", () => {
    expect(() => validateDraftAgainstPlan(draft(), PLAN, DNA)).not.toThrow();
  });

  it("rejects a draft outside the word band", () => {
    expect(() =>
      validateDraftAgainstPlan(draft({ paragraphs: body(40) }), PLAN, DNA),
    ).toThrow();
  });

  it("rejects incomplete beat coverage", () => {
    expect(() =>
      validateDraftAgainstPlan(
        draft({ beatsCovered: ["beat-1", "beat-2"] }),
        PLAN,
        DNA,
      ),
    ).toThrow();
  });

  it("rejects coverage that does not match the plan's beat keys", () => {
    expect(() =>
      validateDraftAgainstPlan(
        draft({
          beatsCovered: [
            "beat-1",
            "beat-2",
            "beat-3",
            "beat-4",
            "beat-5",
            "beat-x",
          ],
        }),
        PLAN,
        DNA,
      ),
    ).toThrow();
  });

  it("rejects an anchor pointing past the end of the prose", () => {
    const d = draft();
    const bad = draft({
      anchors: [
        { key: "a", afterParagraph: d.paragraphs.length + 5, description: "x" },
      ],
    });
    let error: unknown;
    try {
      validateDraftAgainstPlan(bad, PLAN, DNA);
    } catch (e) {
      error = e;
    }
    expect(isDomainError(error)).toBe(true);
  });

  it("rejects more than the maximum illustrations", () => {
    const anchors = Array.from({ length: 6 }, (_v, i) => ({
      key: `a-${i}`,
      afterParagraph: 0,
      description: "x",
    }));
    expect(() =>
      validateDraftAgainstPlan(draft({ anchors }), PLAN, DNA),
    ).toThrow();
  });
});
