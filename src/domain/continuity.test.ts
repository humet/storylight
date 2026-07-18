import { describe, expect, it } from "vitest";

import {
  advancePlotThread,
  applyContinuityChanges,
  assertRegenerationPreservesDependencies,
  continuitySummary,
  createInitialContinuityState,
  type ContinuityChangeSet,
  type ContinuityState,
} from "./continuity";
import { DomainError } from "@/lib/errors";

/**
 * Continuity unit suite (`docs/02-storytelling/continuity.md` "Testing"). Covers
 * the REQUIRED list: possession transfer, reader-only knowledge, outfit changes,
 * temporary emotion vs permanent fact, location movement, thread introduction/
 * resolution, superseded facts, and regeneration with later dependencies. Every
 * canonical change flows the ONE pure {@link applyContinuityChanges}.
 */

/** Assert a call throws a DomainError whose internal detail matches `pattern`. */
function expectReject(fn: () => unknown, pattern: RegExp): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).internalDetail ?? "").toMatch(pattern);
    return;
  }
  throw new Error("expected the call to throw a DomainError");
}

function baseState(): ContinuityState {
  return createInitialContinuityState({
    seriesId: "series-1",
    characterKeys: ["theia", "juno"],
    startingLocationId: "library",
    startingTime: "evening",
    knownLocationIds: ["library", "garden"],
    immutableFacts: [
      { factKey: "twelve-doors", statement: "The library has twelve doors." },
    ],
  });
}

/** An empty change set — every field present, nothing changed. */
function emptyChangeSet(): ContinuityChangeSet {
  return {
    schemaVersion: "continuity-change.v1",
    currentTime: null,
    currentLocationId: null,
    characterMoves: [],
    emotionChanges: [],
    outfitChanges: [],
    possessionChanges: [],
    knowledgeGains: [],
    readerKnowledgeGains: [],
    relationshipChanges: [],
    temporaryConditionChanges: [],
    threadTransitions: [],
    locationDiscoveries: [],
    newFacts: [],
    supersededFacts: [],
  };
}

describe("applyContinuityChanges — purity + chapter number", () => {
  it("does not mutate the previous state and stamps the chapter number", () => {
    const prev = baseState();
    const snapshot = JSON.stringify(prev);
    const next = applyContinuityChanges(
      prev,
      { ...emptyChangeSet(), currentTime: "night" },
      1,
    );
    expect(JSON.stringify(prev)).toBe(snapshot); // untouched
    expect(next.afterChapterNumber).toBe(1);
    expect(next.currentTime).toBe("night");
    expect(prev.currentTime).toBe("evening");
  });
});

describe("location movement", () => {
  it("moves a character to a known location", () => {
    const next = applyContinuityChanges(
      baseState(),
      {
        ...emptyChangeSet(),
        characterMoves: [{ characterKey: "theia", toLocationId: "garden" }],
      },
      1,
    );
    expect(next.characters.theia.currentLocationId).toBe("garden");
    expect(next.characters.juno.currentLocationId).toBe("library");
  });

  it("rejects a move to an unknown location", () => {
    expectReject(
      () =>
        applyContinuityChanges(
          baseState(),
          {
            ...emptyChangeSet(),
            characterMoves: [{ characterKey: "theia", toLocationId: "moon" }],
          },
          1,
        ),
      /unknown location/,
    );
  });

  it("rejects a move for an unknown character", () => {
    expectReject(
      () =>
        applyContinuityChanges(
          baseState(),
          {
            ...emptyChangeSet(),
            characterMoves: [{ characterKey: "ghost", toLocationId: "garden" }],
          },
          1,
        ),
      /unknown character/,
    );
  });

  it("discovers a new location then allows moving to it", () => {
    const next = applyContinuityChanges(
      baseState(),
      {
        ...emptyChangeSet(),
        locationDiscoveries: [{ locationId: "attic", note: "dusty" }],
        characterMoves: [{ characterKey: "juno", toLocationId: "attic" }],
      },
      2,
    );
    expect(next.world.locations.attic.discovered).toBe(true);
    expect(next.characters.juno.currentLocationId).toBe("attic");
  });
});

describe("temporary emotion vs permanent fact", () => {
  it("a temporary emotion is overwritten by the next chapter; a fact persists", () => {
    const afterCh1 = applyContinuityChanges(
      baseState(),
      {
        ...emptyChangeSet(),
        emotionChanges: [{ characterKey: "theia", emotion: "nervous" }],
        newFacts: [
          {
            factKey: "found-map",
            statement: "Theia found the old map.",
            immutable: false,
          },
        ],
      },
      1,
    );
    expect(afterCh1.characters.theia.currentEmotion).toBe("nervous");
    expect(afterCh1.establishedFacts.map((f) => f.factKey)).toContain(
      "found-map",
    );

    const afterCh2 = applyContinuityChanges(
      afterCh1,
      {
        ...emptyChangeSet(),
        emotionChanges: [{ characterKey: "theia", emotion: "calm" }],
      },
      2,
    );
    // Emotion is a current-state layer — overwritten.
    expect(afterCh2.characters.theia.currentEmotion).toBe("calm");
    // The fact is permanent — still present.
    expect(afterCh2.establishedFacts.map((f) => f.factKey)).toContain(
      "found-map",
    );
  });
});

describe("outfit changes", () => {
  it("sets the current outfit and records the visual outfit", () => {
    const next = applyContinuityChanges(
      baseState(),
      {
        ...emptyChangeSet(),
        outfitChanges: [
          {
            characterKey: "juno",
            outfitKey: "red-cloak",
            description: "a bright red travelling cloak",
          },
        ],
      },
      1,
    );
    expect(next.characters.juno.currentOutfitKey).toBe("red-cloak");
    expect(next.visual.outfits["red-cloak"].description).toContain("red");
  });
});

describe("possessions", () => {
  it("possession transfer: given-away moves the item to the counterparty", () => {
    const acquired = applyContinuityChanges(
      baseState(),
      {
        ...emptyChangeSet(),
        possessionChanges: [
          {
            itemKey: "brass-key",
            name: "the brass key",
            characterKey: "theia",
            to: "carried",
            counterpartyKey: null,
            locationId: null,
          },
        ],
      },
      1,
    );
    expect(acquired.characters.theia.possessions["brass-key"].state).toBe(
      "carried",
    );

    const transferred = applyContinuityChanges(
      acquired,
      {
        ...emptyChangeSet(),
        possessionChanges: [
          {
            itemKey: "brass-key",
            name: "the brass key",
            characterKey: "theia",
            to: "given-away",
            counterpartyKey: "juno",
            locationId: null,
          },
        ],
      },
      2,
    );
    expect(transferred.characters.theia.possessions["brass-key"].state).toBe(
      "given-away",
    );
    expect(transferred.characters.juno.possessions["brass-key"].state).toBe(
      "owned",
    );
  });

  it("rejects removing an object the character does not hold", () => {
    expectReject(
      () =>
        applyContinuityChanges(
          baseState(),
          {
            ...emptyChangeSet(),
            possessionChanges: [
              {
                itemKey: "brass-key",
                name: "the brass key",
                characterKey: "theia",
                to: "lost",
                counterpartyKey: null,
                locationId: null,
              },
            ],
          },
          1,
        ),
      /not currently held/,
    );
  });

  it("does NOT treat an unmentioned possession as lost", () => {
    const acquired = applyContinuityChanges(
      baseState(),
      {
        ...emptyChangeSet(),
        possessionChanges: [
          {
            itemKey: "lantern",
            name: "the lantern",
            characterKey: "juno",
            to: "carried",
            counterpartyKey: null,
            locationId: null,
          },
        ],
      },
      1,
    );
    // A later, unrelated chapter that never mentions the lantern.
    const later = applyContinuityChanges(
      acquired,
      { ...emptyChangeSet(), currentTime: "midnight" },
      2,
    );
    expect(later.characters.juno.possessions.lantern.state).toBe("carried");
  });

  it("borrowing requires the lender to hold the item", () => {
    expectReject(
      () =>
        applyContinuityChanges(
          baseState(),
          {
            ...emptyChangeSet(),
            possessionChanges: [
              {
                itemKey: "compass",
                name: "the compass",
                characterKey: "theia",
                to: "borrowed",
                counterpartyKey: "juno",
                locationId: null,
              },
            ],
          },
          1,
        ),
      /does not hold it/,
    );
  });
});

describe("knowledge isolation", () => {
  it("reader-only knowledge never becomes character knowledge", () => {
    const next = applyContinuityChanges(
      baseState(),
      {
        ...emptyChangeSet(),
        readerKnowledgeGains: ["The fox hid the key under the third door."],
        knowledgeGains: [
          { characterKey: "theia", fact: "The door was left ajar." },
        ],
      },
      1,
    );
    expect(next.world.readerKnowledge).toContain(
      "The fox hid the key under the third door.",
    );
    // Neither child gains the reader-only fact.
    expect(next.characters.theia.knowledge).not.toContain(
      "The fox hid the key under the third door.",
    );
    expect(next.characters.juno.knowledge).not.toContain(
      "The fox hid the key under the third door.",
    );
    // The explicit per-character gain is isolated to that character.
    expect(next.characters.theia.knowledge).toContain(
      "The door was left ajar.",
    );
    expect(next.characters.juno.knowledge).not.toContain(
      "The door was left ajar.",
    );
  });
});

describe("plot threads", () => {
  it("introduces then resolves a thread across chapters", () => {
    const ch1 = applyContinuityChanges(
      baseState(),
      {
        ...emptyChangeSet(),
        threadTransitions: [{ threadKey: "missing-cat", to: "introduced" }],
      },
      1,
    );
    expect(ch1.plotThreads["missing-cat"].status).toBe("introduced");
    expect(ch1.plotThreads["missing-cat"].introducedInChapter).toBe(1);

    const ch2 = applyContinuityChanges(
      ch1,
      {
        ...emptyChangeSet(),
        threadTransitions: [{ threadKey: "missing-cat", to: "developing" }],
      },
      2,
    );
    const ch3 = applyContinuityChanges(
      ch2,
      {
        ...emptyChangeSet(),
        threadTransitions: [{ threadKey: "missing-cat", to: "resolved" }],
      },
      3,
    );
    expect(ch3.plotThreads["missing-cat"].status).toBe("resolved");
    expect(ch3.plotThreads["missing-cat"].resolvedInChapter).toBe(3);
  });

  it("rejects resolving an unintroduced (planned) thread", () => {
    expectReject(
      () =>
        applyContinuityChanges(
          baseState(),
          {
            ...emptyChangeSet(),
            threadTransitions: [{ threadKey: "surprise", to: "resolved" }],
          },
          1,
        ),
      /Illegal plot-thread transition/,
    );
  });

  it("rejects regressing a resolved thread", () => {
    const resolved = applyContinuityChanges(
      applyContinuityChanges(
        baseState(),
        {
          ...emptyChangeSet(),
          threadTransitions: [{ threadKey: "t", to: "introduced" }],
        },
        1,
      ),
      {
        ...emptyChangeSet(),
        threadTransitions: [{ threadKey: "t", to: "resolved" }],
      },
      2,
    );
    expectReject(
      () =>
        applyContinuityChanges(
          resolved,
          {
            ...emptyChangeSet(),
            threadTransitions: [{ threadKey: "t", to: "developing" }],
          },
          3,
        ),
      /regression/,
    );
  });

  it("advancePlotThread guards the lifecycle edges", () => {
    expect(advancePlotThread("planned", "introduced")).toBe("introduced");
    expect(advancePlotThread("introduced", "resolved")).toBe("resolved");
    expect(() => advancePlotThread("planned", "resolved")).toThrow();
    expect(() => advancePlotThread("resolved", "developing")).toThrow();
  });
});

describe("facts", () => {
  it("supersedes a mutable fact with a newer one", () => {
    const ch1 = applyContinuityChanges(
      baseState(),
      {
        ...emptyChangeSet(),
        newFacts: [
          {
            factKey: "door-locked",
            statement: "The red door is locked.",
            immutable: false,
          },
        ],
      },
      1,
    );
    const ch2 = applyContinuityChanges(
      ch1,
      {
        ...emptyChangeSet(),
        newFacts: [
          {
            factKey: "door-open",
            statement: "The red door is now open.",
            immutable: false,
          },
        ],
        supersededFacts: [
          { factKey: "door-locked", bySupersedingFactKey: "door-open" },
        ],
      },
      2,
    );
    const locked = ch2.establishedFacts.find(
      (f) => f.factKey === "door-locked",
    );
    expect(locked?.supersededByFactKey).toBe("door-open");
    // The summary omits superseded facts.
    expect(continuitySummary(ch2).facts).not.toContain(
      "The red door is locked.",
    );
    expect(continuitySummary(ch2).facts).toContain("The red door is now open.");
  });

  it("rejects duplicating an existing fact", () => {
    expectReject(
      () =>
        applyContinuityChanges(
          baseState(),
          {
            ...emptyChangeSet(),
            newFacts: [
              {
                factKey: "twelve-doors",
                statement: "duplicate",
                immutable: false,
              },
            ],
          },
          1,
        ),
      /Duplicate/,
    );
  });

  it("rejects superseding an unknown fact", () => {
    expectReject(
      () =>
        applyContinuityChanges(
          baseState(),
          {
            ...emptyChangeSet(),
            newFacts: [{ factKey: "a", statement: "A", immutable: false }],
            supersededFacts: [{ factKey: "nope", bySupersedingFactKey: "a" }],
          },
          1,
        ),
      /unknown fact/,
    );
  });

  it("rejects superseding (changing) an immutable fact", () => {
    expectReject(
      () =>
        applyContinuityChanges(
          baseState(),
          {
            ...emptyChangeSet(),
            newFacts: [
              {
                factKey: "eleven-doors",
                statement: "Eleven doors.",
                immutable: false,
              },
            ],
            supersededFacts: [
              { factKey: "twelve-doors", bySupersedingFactKey: "eleven-doors" },
            ],
          },
          1,
        ),
      /immutable fact/,
    );
  });
});

describe("regeneration with later dependencies", () => {
  it("allows regeneration when no later chapters depend on a dropped fact", () => {
    const replacement = applyContinuityChanges(
      baseState(),
      emptyChangeSet(),
      1,
    );
    // No later snapshots → free to regenerate.
    expect(() =>
      assertRegenerationPreservesDependencies(replacement, []),
    ).not.toThrow();
  });

  it("rejects a regeneration that drops a fact a later chapter relies upon", () => {
    const ch1 = applyContinuityChanges(
      baseState(),
      {
        ...emptyChangeSet(),
        newFacts: [
          {
            factKey: "secret-word",
            statement: "The secret word is 'lumen'.",
            immutable: false,
          },
        ],
      },
      1,
    );
    const ch2 = applyContinuityChanges(ch1, emptyChangeSet(), 2); // carries the fact forward

    // A regenerated chapter-1 snapshot that never establishes the secret word.
    const regenCh1 = applyContinuityChanges(baseState(), emptyChangeSet(), 1);
    expectReject(
      () => assertRegenerationPreservesDependencies(regenCh1, [ch2]),
      /relies upon/,
    );
  });
});
