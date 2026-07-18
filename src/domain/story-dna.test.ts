import { describe, expect, it } from "vitest";

import {
  buildStoryCharacterKeys,
  deriveStoryDna,
  isSemanticKey,
  type SafetyConfig,
} from "./story-dna";

const SAFETY: SafetyConfig = {
  readingAge: "5-7",
  maxSuspense: "mild",
  allowMildPeril: true,
  allowDeathGrief: false,
  excludedTopics: [],
};

describe("deriveStoryDna", () => {
  it("derives a word-count band and beat band from length + reading age", () => {
    const dna = deriveStoryDna({
      length: "standard",
      tone: "gentle",
      characters: [{ id: "c1", name: "Rosa", apparentAge: 7 }],
      safety: SAFETY,
    });
    // 5–7 → 115 wpm × 10 min = 1150 words, ±20%.
    expect(dna.wordCountTarget.min).toBe(920);
    expect(dna.wordCountTarget.max).toBe(1380);
    expect(dna.beatTarget).toEqual({ min: 7, max: 9 });
    expect(dna.targetReadingMinutes).toBe(10);
  });

  it("scales word count with reading age and length", () => {
    const short = deriveStoryDna({
      length: "short",
      tone: "gentle",
      characters: [{ id: "c1", name: "Rosa", apparentAge: 4 }],
      safety: { ...SAFETY, readingAge: "3-4" },
    });
    // 3–4 → 90 wpm × 6 min = 540, ±20%.
    expect(short.wordCountTarget).toEqual({ min: 432, max: 648 });
    expect(short.beatTarget).toEqual({ min: 6, max: 7 });
  });

  it("caps suspense at the family ceiling", () => {
    const dna = deriveStoryDna({
      length: "standard",
      tone: "adventurous",
      requestedSuspense: "adventurous",
      characters: [{ id: "c1", name: "Rosa", apparentAge: 7 }],
      safety: { ...SAFETY, maxSuspense: "calm" },
    });
    expect(dna.suspense).toBe("calm");
  });

  it("adds prohibited outcomes for disallowed peril, grief, and excluded topics", () => {
    const dna = deriveStoryDna({
      length: "standard",
      tone: "gentle",
      characters: [{ id: "c1", name: "Rosa", apparentAge: 7 }],
      safety: {
        ...SAFETY,
        allowMildPeril: false,
        allowDeathGrief: false,
        excludedTopics: ["spiders"],
      },
    });
    expect(dna.prohibitedOutcomes).toContain(
      "any real physical peril or danger to a character",
    );
    expect(dna.prohibitedOutcomes).toContain("death, dying, or grief");
    expect(dna.prohibitedOutcomes).toContain('the excluded topic "spiders"');
    // The always-prohibited bedtime list is present too.
    expect(dna.prohibitedOutcomes).toContain("graphic harm or injury");
  });
});

describe("buildStoryCharacterKeys", () => {
  it("builds unique semantic keys and disambiguates collisions", () => {
    const keys = buildStoryCharacterKeys([
      { id: "1", name: "Rosa", apparentAge: 7 },
      { id: "2", name: "Rosa", apparentAge: 5 },
    ]);
    expect(keys[0].key).toBe("rosa");
    expect(keys[1].key).toBe("rosa-2");
    expect(keys.every((k) => isSemanticKey(k.key))).toBe(true);
  });

  it("prefixes a key that would not start with a letter", () => {
    const [key] = buildStoryCharacterKeys([
      { id: "1", name: "7 the robot", apparentAge: 9 },
    ]);
    expect(isSemanticKey(key.key)).toBe(true);
    expect(key.key.startsWith("c-")).toBe(true);
  });
});
