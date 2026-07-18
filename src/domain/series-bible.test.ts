import { describe, expect, it } from "vitest";

import { DomainError } from "@/lib/errors";
import {
  crossReferenceSeriesBible,
  normaliseSeriesBible,
  validateSeriesBible,
  type SeriesBible,
  type SeriesBibleWireLike,
} from "./series-bible";
import { deriveStoryDna } from "./story-dna";

/**
 * Series bible structural + semantic validation (`docs/02-storytelling/story-series.md`
 * "Series creation" step 4). A well-formed 5-chapter bible passes; a bible that
 * leaves a thread unresolved, mis-covers chapters, or fails to resolve the central
 * question in the final chapter is REJECTED (→ the pipeline regenerates).
 */

function validWireBible(): SeriesBibleWireLike {
  return {
    schemaVersion: "series-bible.v1",
    title: "The Moonwood Library",
    spoilerFreePremise:
      "Two friends discover a library that only opens at night.",
    internalSynopsis:
      "Theia and Juno find the twelve-door library and must return a lost story before dawn.",
    emotionalPromise: "Courage grows from small, shared choices.",
    worldRules: ["The twelve doors open only for a understood question."],
    locations: [
      { key: "library", name: "The Moonwood Library" },
      { key: "garden", name: "The Night Garden" },
    ],
    startingLocationKey: "library",
    cast: [
      { characterKey: "theia", role: "the curious one" },
      { characterKey: "juno", role: "the careful one" },
    ],
    centralQuestion: "Can the friends return the lost story before dawn?",
    centralConflict: "The library is closing its doors one by one.",
    plannedEnding:
      "The story is returned and the library rests, warm and safe.",
    characterArcs: [
      { characterKey: "theia", arc: "learns to look before leaping" },
      { characterKey: "juno", arc: "learns to trust a leap" },
    ],
    plotThreads: [
      {
        threadKey: "lost-story",
        description: "A story has gone missing from the library.",
        introduceInChapter: 1,
        resolveInChapter: 5,
        central: true,
      },
      {
        threadKey: "shy-lantern",
        description: "A lantern-sprite is afraid to shine.",
        introduceInChapter: 2,
        resolveInChapter: 4,
        central: false,
      },
    ],
    chapterBlueprints: [1, 2, 3, 4, 5].map((chapterNumber) => ({
      chapterNumber,
      narrativePurpose: `purpose ${chapterNumber}`,
      openingState: `opening ${chapterNumber}`,
      localGoal: `goal ${chapterNumber}`,
      conflict: `conflict ${chapterNumber}`,
      majorBeats: [
        { key: `c${chapterNumber}-b1`, description: "beat one" },
        { key: `c${chapterNumber}-b2`, description: "beat two" },
      ],
      emotionalMovement: `movement ${chapterNumber}`,
      informationRevealed: `reveal ${chapterNumber}`,
      threadsIntroduced:
        chapterNumber === 1
          ? ["lost-story"]
          : chapterNumber === 2
            ? ["shy-lantern"]
            : [],
      threadsAdvanced: chapterNumber === 3 ? ["lost-story"] : [],
      threadsResolved:
        chapterNumber === 4
          ? ["shy-lantern"]
          : chapterNumber === 5
            ? ["lost-story"]
            : [],
      closingState: `closing ${chapterNumber}`,
      tomorrowPromise:
        chapterNumber < 5 ? `tomorrow ${chapterNumber}` : "the end",
    })),
    immutableFacts: [
      { factKey: "twelve-doors", statement: "The library has twelve doors." },
    ],
    forbiddenDevelopments: ["No character is ever truly lost."],
  };
}

const DNA = deriveStoryDna({
  length: "standard",
  tone: "gentle",
  characters: [
    { id: "id-theia", name: "Theia", apparentAge: 7 },
    { id: "id-juno", name: "Juno", apparentAge: 6 },
  ],
  safety: {
    readingAge: "5-7",
    maxSuspense: "mild",
    allowMildPeril: true,
    allowDeathGrief: false,
    excludedTopics: [],
  },
});

/** The DNA-derived cast keys ("theia", "juno") match the fixture bible keys. */
function bible(overrides?: (w: SeriesBibleWireLike) => void): SeriesBible {
  const wire = validWireBible();
  overrides?.(wire);
  return normaliseSeriesBible(wire, 5);
}

function expectReject(fn: () => unknown, pattern: RegExp): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).internalDetail ?? "").toMatch(pattern);
    return;
  }
  throw new Error("expected a DomainError");
}

describe("validateSeriesBible", () => {
  it("accepts a well-formed 5-chapter bible", () => {
    expect(() => validateSeriesBible(bible())).not.toThrow();
  });

  it("rejects a bible whose blueprint count differs from the chapter count", () => {
    const wire = validWireBible();
    wire.chapterBlueprints = wire.chapterBlueprints.slice(0, 4);
    expectReject(
      () => validateSeriesBible(normaliseSeriesBible(wire, 5)),
      /blueprints/,
    );
  });

  it("rejects a bible that leaves a plot thread unresolved", () => {
    const wire = validWireBible();
    // Remove the resolution of the non-central thread in chapter 4.
    wire.chapterBlueprints[3].threadsResolved = [];
    expectReject(
      () => validateSeriesBible(normaliseSeriesBible(wire, 5)),
      /never resolved/,
    );
  });

  it("rejects a bible whose central thread does not resolve in the final chapter", () => {
    const wire = validWireBible();
    wire.plotThreads[0].resolveInChapter = 3;
    wire.chapterBlueprints[4].threadsResolved = [];
    wire.chapterBlueprints[2].threadsResolved = ["lost-story"];
    expectReject(
      () => validateSeriesBible(normaliseSeriesBible(wire, 5)),
      /final chapter/,
    );
  });

  it("rejects a blueprint that introduces a thread in the wrong chapter", () => {
    const wire = validWireBible();
    wire.chapterBlueprints[0].threadsIntroduced = [];
    wire.chapterBlueprints[2].threadsIntroduced = ["lost-story"];
    expectReject(
      () => validateSeriesBible(normaliseSeriesBible(wire, 5)),
      /introduced in chapter/,
    );
  });

  it("rejects an unknown starting location", () => {
    const wire = validWireBible();
    wire.startingLocationKey = "nowhere";
    expectReject(
      () => validateSeriesBible(normaliseSeriesBible(wire, 5)),
      /Starting location/,
    );
  });
});

describe("crossReferenceSeriesBible", () => {
  it("passes when cast keys match the Story DNA", () => {
    expect(() =>
      crossReferenceSeriesBible(validWireBible(), DNA),
    ).not.toThrow();
  });

  it("rejects a cast member not in the Story DNA", () => {
    const wire = validWireBible();
    wire.cast.push({ characterKey: "stranger", role: "?" });
    expectReject(
      () => crossReferenceSeriesBible(wire, DNA),
      /unknown character/,
    );
  });
});
