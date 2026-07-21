import { and, asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFakeLanguageModel } from "@/adapters/ai/fake-language-model";
import type {
  FakeModelResponse,
  FakeScript,
} from "@/adapters/ai/fake-language-model";
import { createStructuredGenerator } from "@/application/ai/generate-structured";
import { createModelRegistry } from "@/application/model-routes/model-registry";
import { createModelPricing } from "@/application/model-routes/pricing";
import { createSeriesCommands } from "@/application/series-commands";
import { createSeriesQueries } from "@/application/series-queries";
import { createWorkflowEngine } from "@/application/workflow-engine";
import { createWorkflowRegistry } from "@/application/workflow-registry";
import { createWorkflowService } from "@/application/workflow-service";
import { GENERATE_NEXT_CHAPTER_TYPE } from "@/application/workflows/generate-next-chapter-workflow";
import type { AuthenticatedActor } from "@/domain/actor";
import type { CharacterProfilePayload } from "@/domain/character";
import type { ContinuityState } from "@/domain/continuity";
import type { LanguageModelRequest } from "@/application/ports/language-model";
import type { Database } from "./client";
import { createCharacterRepository } from "./repositories/character-repository";
import { createFamilyRepository } from "./repositories/family-repository";
import { createGenerationRunRepository } from "./repositories/generation-run-repository";
import { createModelRouteRepository } from "./repositories/model-route-repository";
import { createSeriesRepository } from "./repositories/series-repository";
import { createStoryRepository } from "./repositories/story-repository";
import { createWorkflowRepository } from "./repositories/workflow-repository";
import {
  chapterRevisions,
  chapters,
  continuitySnapshots,
  generationRuns,
  illustrationSpecs,
  modelRouteVersions,
  users,
} from "./schema";
import { createTestDatabase, type TestDatabase } from "./testing";

/**
 * Milestone 8 EXIT CRITERION (`docs/IMPLEMENTATION_PLAN.md`): "a five-chapter
 * synthetic series completes without critical drift; concurrent requests cannot
 * duplicate a chapter." The whole series pipeline runs on the REAL engine + Drizzle
 * repositories + a scripted FAKE language adapter against a migrated-from-empty
 * PGlite. No child production data; no paid provider call (AGENTS.md).
 */

const CHAPTER_COUNT = 5;
const CENTRAL_THREAD = "the-lost-lantern";
const CAST_KEYS = ["theia", "juno"];

// --- Canonical-context parsing (mirror the dev fixture) -----------------

interface Canonical {
  chapterCount?: number;
  chapterNumber?: number;
  beatTarget?: { min: number; max: number };
  wordCountTarget?: { min: number; max: number };
  characters?: { key: string; name: string }[];
  plan?: { beats?: { key: string }[] };
  anchorKeys?: string[];
}

function parseCanonical(prompt: string): Canonical {
  const match = prompt.match(
    /<canonical_context>\n([\s\S]*?)\n\s*<\/canonical_context>/,
  );
  if (!match) return {};
  const unescaped = match[1]
    .replace(/\\u003c/g, "<")
    .replace(/\\u003e/g, ">")
    .replace(/\\u0026/g, "&");
  try {
    return JSON.parse(unescaped) as Canonical;
  } catch {
    return {};
  }
}

// --- Fixtures -----------------------------------------------------------

function bibleFixture(castKeys: string[]) {
  const blueprints = Array.from({ length: CHAPTER_COUNT }, (_v, i) => {
    const chapterNumber = i + 1;
    return {
      chapterNumber,
      narrativePurpose: `Advance the quest one gentle step (chapter ${chapterNumber}).`,
      openingState: "The friends wake to a soft morning.",
      localGoal: "Find the next small clue.",
      conflict: "A gentle obstacle invites courage.",
      majorBeats: [
        { key: `c${chapterNumber}-b1`, description: "They set out together." },
        { key: `c${chapterNumber}-b2`, description: "They help and learn." },
      ],
      emotionalMovement: "From worry to warm reassurance.",
      informationRevealed: "A small, kind truth.",
      threadsIntroduced: chapterNumber === 1 ? [CENTRAL_THREAD] : [],
      threadsAdvanced:
        chapterNumber > 1 && chapterNumber < CHAPTER_COUNT
          ? [CENTRAL_THREAD]
          : [],
      threadsResolved: chapterNumber === CHAPTER_COUNT ? [CENTRAL_THREAD] : [],
      closingState: "Cosy and safe.",
      tomorrowPromise:
        chapterNumber < CHAPTER_COUNT
          ? "Tomorrow, a new path opens."
          : "the end",
    };
  });
  return {
    schemaVersion: "series-bible.v1",
    title: "The Moonwood Friends",
    spoilerFreePremise: "Friends explore a glowing night forest together.",
    internalSynopsis:
      "SECRET-SYNOPSIS: they return the lost lantern by night five.",
    emotionalPromise: "Courage grows from small kindnesses.",
    worldRules: ["The Moonwood glows only for the kind."],
    locations: [
      { key: "home", name: "The warm house" },
      { key: "moonwood", name: "The Moonwood" },
    ],
    startingLocationKey: "home",
    cast: castKeys.map((characterKey) => ({ characterKey, role: "a friend" })),
    centralQuestion: "Can they return the lantern before the last night?",
    centralConflict: "The Moonwood is going dark.",
    plannedEnding:
      "The lantern is home, the wood glows, and all sleep soundly.",
    characterArcs: castKeys.map((characterKey) => ({
      characterKey,
      arc: "learns to be brave and kind",
    })),
    plotThreads: [
      {
        threadKey: CENTRAL_THREAD,
        description: "A lantern that lights the Moonwood has gone missing.",
        introduceInChapter: 1,
        resolveInChapter: CHAPTER_COUNT,
        central: true,
      },
    ],
    chapterBlueprints: blueprints,
    immutableFacts: [
      { factKey: "moonwood-glows", statement: "The Moonwood glows at night." },
    ],
    forbiddenDevelopments: ["No friend is ever truly lost."],
  };
}

function chapterPlanFixture(ctx: Canonical) {
  const beatCount = ctx.beatTarget?.min ?? 7;
  const key = ctx.characters?.[0]?.key ?? "theia";
  const beats = Array.from({ length: beatCount }, (_v, i) => ({
    key: `beat-${i + 1}`,
    description: `gentle step ${i + 1}`,
  }));
  return {
    schemaVersion: "chapter-plan.v1",
    title: "Into the Moonwood",
    setting: "A soft path into the glowing wood",
    protagonistKey: key,
    protagonistDesire: "to follow the lantern's light",
    obstacle: "the path forks in the dark",
    emotionalTheme: "small brave steps",
    beats,
    climax: "For a moment the light dims",
    resolution: "A kind friend of the wood lights the path",
    calmingClose: "Warm and sleepy, they rest for tomorrow",
  };
}

const PARAGRAPH =
  "The friends stepped softly along the cool path and looked around the quiet, glowing wood, where the evening had folded itself gently over every sleeping tree and hopeful heart.";

function draftFixture(ctx: Canonical) {
  const beatKeys = ctx.plan?.beats?.map((b) => b.key) ?? ["beat-1"];
  const paragraphs = Array.from({ length: 24 }, () => PARAGRAPH);
  return {
    schemaVersion: "chapter-draft.v1",
    title: "Into the Moonwood",
    paragraphs,
    beatsCovered: beatKeys,
    illustrationAnchors: [
      { key: "anchor-1", afterParagraph: 1, description: "The glowing wood" },
    ],
  };
}

const REVIEW_CLEAN = {
  schemaVersion: "chapter-review.v1",
  completeArc: true,
  resolvesCentralProblem: true,
  endsCalmly: true,
  sequelDependency: false,
  ageAppropriate: true,
  findings: [],
  summary: "A gentle, complete chapter that ends calmly.",
};

function illustrationFixture(ctx: Canonical) {
  const keys = ctx.anchorKeys ?? [];
  return {
    schemaVersion: "illustration-plan.v3",
    illustrations: keys.map((anchorKey) => ({
      anchorKey,
      caption: "The wood glows softly.",
      sceneDescription: "Friends on a glowing path at night.",
      aspect: "landscape",
    })),
  };
}

function emptyChange() {
  return {
    schemaVersion: "continuity-change.v1",
    currentTime: "night" as string | null,
    currentLocationId: null as string | null,
    characterMoves: [] as { characterKey: string; toLocationId: string }[],
    emotionChanges: [] as { characterKey: string; emotion: string | null }[],
    outfitChanges: [] as {
      characterKey: string;
      outfitKey: string;
      description: string;
    }[],
    possessionChanges: [] as {
      itemKey: string;
      name: string;
      characterKey: string;
      to: string;
      counterpartyKey: string | null;
      locationId: string | null;
    }[],
    knowledgeGains: [] as { characterKey: string; fact: string }[],
    readerKnowledgeGains: [] as string[],
    relationshipChanges: [] as {
      characterKey: string;
      withCharacterKey: string;
      standing: string;
      note: string | null;
    }[],
    temporaryConditionChanges: [] as {
      characterKey: string;
      condition: string;
      add: boolean;
    }[],
    threadTransitions: [] as { threadKey: string; to: string }[],
    locationDiscoveries: [] as { locationId: string; note: string | null }[],
    newFacts: [] as {
      factKey: string;
      statement: string;
      immutable: boolean;
    }[],
    supersededFacts: [] as {
      factKey: string;
      bySupersedingFactKey: string;
    }[],
  };
}

/** The continuity a chapter made — progresses possessions, facts, and the thread. */
function continuityFixture(chapterNumber: number) {
  const change = emptyChange();
  if (chapterNumber === 1) {
    change.currentLocationId = "moonwood";
    change.characterMoves = [
      { characterKey: "theia", toLocationId: "moonwood" },
      { characterKey: "juno", toLocationId: "moonwood" },
    ];
    change.locationDiscoveries = [{ locationId: "moonwood", note: null }];
    change.possessionChanges = [
      {
        itemKey: "lantern",
        name: "the lantern",
        characterKey: "theia",
        to: "carried",
        counterpartyKey: null,
        locationId: null,
      },
    ];
    change.knowledgeGains = [
      { characterKey: "theia", fact: "The lantern is warm." },
    ];
    change.readerKnowledgeGains = ["An owl watches from the trees."];
    change.newFacts = [
      {
        factKey: "lantern-found",
        statement: "Theia found the lantern.",
        immutable: false,
      },
    ];
    change.threadTransitions = [
      { threadKey: CENTRAL_THREAD, to: "introduced" },
    ];
    return change;
  }
  if (chapterNumber === 2 || chapterNumber === 3) {
    change.threadTransitions = [
      { threadKey: CENTRAL_THREAD, to: "developing" },
    ];
    change.newFacts = [
      {
        factKey: `clue-${chapterNumber}`,
        statement: `A clue was found in chapter ${chapterNumber}.`,
        immutable: false,
      },
    ];
    return change;
  }
  if (chapterNumber === 4) {
    change.threadTransitions = [
      { threadKey: CENTRAL_THREAD, to: "developing" },
    ];
    change.possessionChanges = [
      {
        itemKey: "lantern",
        name: "the lantern",
        characterKey: "theia",
        to: "given-away",
        counterpartyKey: "juno",
        locationId: null,
      },
    ];
    return change;
  }
  // Final chapter.
  change.threadTransitions = [{ threadKey: CENTRAL_THREAD, to: "resolved" }];
  change.possessionChanges = [
    {
      itemKey: "lantern",
      name: "the lantern",
      characterKey: "juno",
      to: "stored",
      counterpartyKey: null,
      locationId: "home",
    },
  ];
  change.newFacts = [
    {
      factKey: "lantern-home",
      statement: "The lantern is home.",
      immutable: false,
    },
  ];
  return change;
}

/** The full scripted series adapter. `badContinuityChapters` returns one bad
 * changeset first for those chapters (to exercise regeneration). */
function seriesScript(options?: {
  badContinuityChapters?: Set<number>;
}): FakeScript {
  const badSeen = new Set<number>();
  return (request: LanguageModelRequest): FakeModelResponse => {
    const ctx = parseCanonical(request.prompt);
    const text = (value: unknown): FakeModelResponse => ({
      kind: "text",
      text: JSON.stringify(value),
    });
    switch (request.schemaName) {
      case "StorylightSeriesBible":
        return text(bibleFixture(CAST_KEYS));
      case "StorylightChapterPlan":
        return text(chapterPlanFixture(ctx));
      case "StorylightChapterDraft":
        return text(draftFixture(ctx));
      case "StorylightChapterReview":
        return text(REVIEW_CLEAN);
      case "StorylightIllustrationPlan":
        return text(illustrationFixture(ctx));
      case "StorylightContinuityChange": {
        const n = ctx.chapterNumber ?? 1;
        if (options?.badContinuityChapters?.has(n) && !badSeen.has(n)) {
          badSeen.add(n);
          // A contradiction: resolve an unintroduced thread → domain-invalid →
          // the pipeline regenerates.
          const bad = emptyChange();
          bad.threadTransitions = [
            { threadKey: "phantom-thread", to: "resolved" },
          ];
          return text(bad);
        }
        return text(continuityFixture(n));
      }
      default:
        return text({});
    }
  };
}

// --- Harness ------------------------------------------------------------

let harness: TestDatabase;
let db: Database;
let familyRepo: ReturnType<typeof createFamilyRepository>;

async function seedUser(id: string): Promise<string> {
  await db.insert(users).values({
    id,
    name: `User ${id}`,
    email: `${id}@example.test`,
    emailVerified: true,
  });
  return id;
}

async function seedFamily(userId: string, name: string): Promise<string> {
  const { family } = await familyRepo.createFamilyWithOwner({
    userId,
    familyName: name,
  });
  return family.id;
}

function ownerActor(userId: string, familyId: string): AuthenticatedActor {
  return { userId, familyIds: [familyId], roles: ["owner"] };
}

function characterPayload(): CharacterProfilePayload {
  return {
    displayName: "placeholder",
    apparentAge: 7,
    pronouns: ["they", "them"],
    appearanceNotes: null,
    narrativeIdentity: {
      personalityTraits: [],
      strengths: ["gentle", "curious"],
      vulnerabilities: [],
      interests: ["fireflies"],
      values: [],
      speechStyle: {
        sentenceLength: "mixed",
        directness: "direct",
        humourStyle: [],
        vocabularyNotes: [],
        prohibitedPatterns: [],
      },
      behaviourRules: [],
      forbiddenCharacterisations: [],
    },
    fictionalisationPolicy: {
      mayUseMagic: true,
      mayTransformTemporarily: false,
      mayPortrayMildDisagreement: true,
      mayPortrayFear: true,
      mayUseRealFamilyMembers: false,
      mayInventSchoolOrHomeDetails: true,
      excludedThemes: [],
    },
    visualProfileId: null,
  };
}

async function seedCharacter(
  familyId: string,
  key: string,
  displayName: string,
): Promise<string> {
  const repo = createCharacterRepository(db);
  const created = await repo.createCharacter({
    familyId,
    characterKey: key,
    payload: { ...characterPayload(), displayName },
  });
  await repo.setStatus({
    familyId,
    characterId: created.id,
    status: "active",
    approvedAt: new Date(),
  });
  return created.id;
}

function buildStack(script: FakeScript) {
  const workflowRepo = createWorkflowRepository(db);
  const generationRunRepository = createGenerationRunRepository(db);
  const storyRepository = createStoryRepository(db);
  const seriesRepository = createSeriesRepository(db);
  const characterRepository = createCharacterRepository(db);
  const modelRouteRepository = createModelRouteRepository(db);
  const modelRegistry = createModelRegistry(modelRouteRepository);
  const structuredGenerator = createStructuredGenerator({
    modelRegistry,
    languageModel: createFakeLanguageModel(script),
    pricing: createModelPricing(),
  });
  const registry = createWorkflowRegistry({
    visualCharacterService: {} as never,
    structuredGenerator,
    generationRunRepository,
    storyRepository,
    characterRepository,
    seriesRepository,
    modelRouteRepository,
  });
  const engine = createWorkflowEngine({ repo: workflowRepo, registry });
  const service = createWorkflowService({
    familyRepository: familyRepo,
    workflowRepository: workflowRepo,
    registry,
    dispatcher: { async dispatch() {} },
  });
  const seriesCommands = createSeriesCommands({
    familyRepository: familyRepo,
    storyRepository,
    seriesRepository,
    characterRepository,
    workflowService: service,
  });
  const seriesQueries = createSeriesQueries({
    familyRepository: familyRepo,
    seriesRepository,
  });
  return {
    engine,
    service,
    seriesCommands,
    seriesQueries,
    seriesRepository,
    workflowRepo,
  };
}

beforeEach(async () => {
  harness = await createTestDatabase();
  db = harness.db;
  familyRepo = createFamilyRepository(db);
});

afterEach(async () => {
  await harness.close();
});

const baseCommand = (characterIds: string[], requestId: string) => ({
  requestId,
  idea: "A gentle quest to return a lost lantern to the Moonwood",
  characterIds,
  length: "standard" as const,
  tone: "gentle" as const,
  theme: null,
  chapterCount: 5 as const,
});

async function drive(
  engine: ReturnType<typeof buildStack>["engine"],
  id: string,
) {
  return engine.runToCompletion(id, { sleep: async () => {} });
}

async function snapshotStates(storyId: string): Promise<ContinuityState[]> {
  const rows = await db
    .select()
    .from(continuitySnapshots)
    .where(eq(continuitySnapshots.storyId, storyId))
    .orderBy(asc(continuitySnapshots.afterChapterNumber));
  return rows.map((r) => r.state);
}

describe("M8 series pipeline", () => {
  it("a five-chapter synthetic series completes without critical drift", async () => {
    const user = await seedUser("m8-full");
    const familyId = await seedFamily(user, "Readers");
    const theia = await seedCharacter(familyId, "theia-0001", "Theia");
    const juno = await seedCharacter(familyId, "juno-0001", "Juno");
    const actor = ownerActor(user, familyId);
    const stack = buildStack(seriesScript());

    // Create the series → Chapter 1.
    const { storyId, workflowId } = await stack.seriesCommands.createSeries(
      actor,
      baseCommand([theia, juno], "series-1"),
    );
    expect((await drive(stack.engine, workflowId)).finalStatus).toBe(
      "completed",
    );

    // Chapters 2..5 via "Continue tonight".
    for (let chapter = 2; chapter <= CHAPTER_COUNT; chapter++) {
      const next = await stack.seriesCommands.continueSeries(actor, {
        storyId,
      });
      expect(next.chapterNumber).toBe(chapter);
      expect((await drive(stack.engine, next.workflowId)).finalStatus).toBe(
        "completed",
      );
    }

    // Exactly five published chapters, each an accepted revision.
    const accepted = await db
      .select()
      .from(chapterRevisions)
      .where(
        and(
          eq(chapterRevisions.storyId, storyId),
          eq(chapterRevisions.status, "accepted"),
        ),
      );
    expect(accepted).toHaveLength(CHAPTER_COUNT);

    // The snapshot chain: initial (0) + one per chapter (1..5), chained.
    const states = await snapshotStates(storyId);
    expect(states.map((s) => s.afterChapterNumber)).toEqual([0, 1, 2, 3, 4, 5]);

    const final = states.at(-1)!;
    // Thread introduced ch1 → resolved ch5 (no drift, no regression).
    expect(final.plotThreads[CENTRAL_THREAD].status).toBe("resolved");
    expect(final.plotThreads[CENTRAL_THREAD].introducedInChapter).toBe(1);
    expect(final.plotThreads[CENTRAL_THREAD].resolvedInChapter).toBe(5);

    // Facts accumulate and SURVIVE to the end (critical-fact survival).
    const factKeys = final.establishedFacts.map((f) => f.factKey);
    expect(factKeys).toEqual(
      expect.arrayContaining([
        "moonwood-glows",
        "lantern-found",
        "clue-2",
        "clue-3",
        "lantern-home",
      ]),
    );
    // The immutable series fact is present in EVERY snapshot.
    for (const state of states) {
      expect(state.establishedFacts.map((f) => f.factKey)).toContain(
        "moonwood-glows",
      );
    }

    // Possession transfer survived: theia gave the lantern (ch4) to juno, who
    // stored it home (ch5).
    expect(final.characters.theia.possessions.lantern.state).toBe("given-away");
    expect(final.characters.juno.possessions.lantern.state).toBe("stored");
    expect(final.characters.juno.possessions.lantern.locationId).toBe("home");

    // Knowledge isolation held across the whole series.
    expect(final.world.readerKnowledge).toContain(
      "An owl watches from the trees.",
    );
    expect(final.characters.theia.knowledge).not.toContain(
      "An owl watches from the trees.",
    );
    expect(final.characters.juno.knowledge).not.toContain(
      "An owl watches from the trees.",
    );

    // The overview reports completion.
    const overview = await stack.seriesQueries.getSeriesOverview(
      actor,
      storyId,
    );
    expect(overview?.isComplete).toBe(true);
    expect(overview?.publishedChapterCount).toBe(CHAPTER_COUNT);
    expect(overview?.nextChapterNumber).toBeNull();
  });

  it("a rejected continuity change set regenerates, then the chapter publishes", async () => {
    const user = await seedUser("m8-regen");
    const familyId = await seedFamily(user, "Regen");
    const theia = await seedCharacter(familyId, "theia-r", "Theia");
    const juno = await seedCharacter(familyId, "juno-r", "Juno");
    const actor = ownerActor(user, familyId);
    // Chapter 1's FIRST continuity change is contradictory → regenerate.
    const stack = buildStack(
      seriesScript({ badContinuityChapters: new Set([1]) }),
    );

    const { storyId, workflowId } = await stack.seriesCommands.createSeries(
      actor,
      baseCommand([theia, juno], "series-regen"),
    );
    expect((await drive(stack.engine, workflowId)).finalStatus).toBe(
      "completed",
    );

    // The chapter still published (one accepted revision + a chapter-1 snapshot).
    const states = await snapshotStates(storyId);
    expect(states.map((s) => s.afterChapterNumber)).toEqual([0, 1]);

    // The continuity-extraction runs show a rejected attempt then an accepted one.
    const runs = await db
      .select()
      .from(generationRuns)
      .where(
        and(
          eq(generationRuns.workflowId, workflowId),
          eq(generationRuns.capability, "continuity-extraction"),
        ),
      )
      .orderBy(asc(generationRuns.attemptIndex));
    expect(runs.some((r) => r.outcome === "rejected")).toBe(true);
    expect(
      runs.some((r) =>
        ["accepted", "regenerated", "repaired"].includes(r.outcome),
      ),
    ).toBe(true);
  });

  it("concurrent 'Continue tonight' requests collapse to ONE chapter (app-lock path)", async () => {
    const user = await seedUser("m8-lock");
    const familyId = await seedFamily(user, "Lockers");
    const theia = await seedCharacter(familyId, "theia-l", "Theia");
    const juno = await seedCharacter(familyId, "juno-l", "Juno");
    const actor = ownerActor(user, familyId);
    const stack = buildStack(seriesScript());

    const { storyId, workflowId } = await stack.seriesCommands.createSeries(
      actor,
      baseCommand([theia, juno], "series-lock"),
    );
    await drive(stack.engine, workflowId);

    // Two concurrent taps → the DETERMINISTIC requestId dedupes to one workflow.
    const [a, b] = await Promise.all([
      stack.seriesCommands.continueSeries(actor, { storyId }),
      stack.seriesCommands.continueSeries(actor, { storyId }),
    ]);
    expect(a.workflowId).toBe(b.workflowId);
    expect(a.chapterNumber).toBe(2);

    await drive(stack.engine, a.workflowId);

    // Exactly one chapter 2.
    const chapter2 = await db
      .select()
      .from(chapters)
      .where(and(eq(chapters.storyId, storyId), eq(chapters.chapterNumber, 2)));
    expect(chapter2).toHaveLength(1);
  });

  it("two distinct workflows racing to publish the same chapter collapse to one (constraint path)", async () => {
    const user = await seedUser("m8-race");
    const familyId = await seedFamily(user, "Racers");
    const theia = await seedCharacter(familyId, "theia-x", "Theia");
    const juno = await seedCharacter(familyId, "juno-x", "Juno");
    const actor = ownerActor(user, familyId);
    const stack = buildStack(seriesScript());

    const { storyId, workflowId } = await stack.seriesCommands.createSeries(
      actor,
      baseCommand([theia, juno], "series-race"),
    );
    await drive(stack.engine, workflowId);

    // Two DISTINCT next-chapter workflows (different requestIds) both target
    // chapter 2 (acceptedCount is 1 for both until one publishes). Drive the first
    // to completion, then the second — the second's deterministic chapter/revision
    // ids + the partial-unique-accepted / snapshot constraints collapse any
    // duplicate. (Because the engine re-reads context per stage, the second in
    // fact advances to chapter 3 once the first commits — proving it can NEVER
    // duplicate chapter 2.)
    const wA = await stack.service.startWorkflow(
      actor,
      GENERATE_NEXT_CHAPTER_TYPE,
      "race-a",
      { storyId },
    );
    const wB = await stack.service.startWorkflow(
      actor,
      GENERATE_NEXT_CHAPTER_TYPE,
      "race-b",
      { storyId },
    );
    expect(wA.workflowId).not.toBe(wB.workflowId);

    await drive(stack.engine, wA.workflowId);
    await drive(stack.engine, wB.workflowId);

    // Chapter 2 exists exactly once; chapter 3 also exactly once (no duplicates).
    const chapter2 = await db
      .select()
      .from(chapters)
      .where(and(eq(chapters.storyId, storyId), eq(chapters.chapterNumber, 2)));
    expect(chapter2).toHaveLength(1);
    const accepted2 = await db
      .select()
      .from(chapterRevisions)
      .where(
        and(
          eq(chapterRevisions.chapterId, chapter2[0].id),
          eq(chapterRevisions.status, "accepted"),
        ),
      );
    expect(accepted2).toHaveLength(1);
  });

  it("directly double-publishing one chapter number yields one accepted revision + snapshot", async () => {
    // A pure repository-level proof of the constraint-race collapse: two publishes
    // of the SAME (story, chapter) with DIFFERENT content → one accepted revision.
    const user = await seedUser("m8-dbl");
    const familyId = await seedFamily(user, "Doublers");
    const theia = await seedCharacter(familyId, "theia-d", "Theia");
    const juno = await seedCharacter(familyId, "juno-d", "Juno");
    const actor = ownerActor(user, familyId);
    const stack = buildStack(seriesScript());
    const { storyId, workflowId } = await stack.seriesCommands.createSeries(
      actor,
      baseCommand([theia, juno], "series-dbl"),
    );
    await drive(stack.engine, workflowId);
    const context = await stack.seriesRepository.getSeriesContext(storyId);

    // The two writers plan DIFFERENT illustration sets with DIFFERENT anchor keys.
    // Because illustration_specs are UNIQUE(revision_id, anchor_key) and the revision
    // id is deterministic (shared by both writers), the loser's specs would NOT
    // collide with the winner's — so without the author-only guard they would leak
    // into the winner's immutable revision.
    const spec = (anchorKey: string, caption: string) => ({
      anchorKey,
      afterParagraph: 1,
      caption,
      sceneDescription: "A scene.",
      aspect: "landscape" as const,
      schemaVersion: "illustration-plan.v2",
      subjectCharacterIds: [] as string[],
      prominentCharacterId: null,
    });
    const publishInput = (
      title: string,
      wfId: string,
      specs: ReturnType<typeof spec>[],
    ) => ({
      familyId,
      storyId,
      workflowId: wfId,
      chapterNumber: 2,
      title,
      plan: {
        title,
        setting: "s",
        protagonistKey: "theia",
        protagonistDesire: "d",
        obstacle: "o",
        emotionalTheme: "e",
        beats: [{ key: "b1", description: "d" }],
        climax: "c",
        resolution: "r",
        calmingClose: "cc",
      },
      draftParagraphs: ["one", "two", "three"],
      wordCount: 3,
      schemaVersion: "chapter-draft.v1",
      review: {
        review: REVIEW_CLEAN,
        decision: "approve" as const,
        revisionsUsed: 0,
      },
      illustrationSpecs: specs,
      continuityState: context!.latestSnapshot,
      threadStates: [],
      isFinalChapter: false,
    });

    const winnerSpecs = [
      spec("winner-anchor-a", "Winner scene A"),
      spec("winner-anchor-b", "Winner scene B"),
    ];
    const loserSpecs = [
      spec("loser-anchor-x", "Loser scene X"),
      spec("loser-anchor-y", "Loser scene Y"),
      spec("loser-anchor-z", "Loser scene Z"),
    ];

    const winner = await stack.seriesRepository.publishSeriesChapter(
      publishInput("First", "wf-1", winnerSpecs),
    );
    await stack.seriesRepository.publishSeriesChapter(
      publishInput("Second", "wf-2", loserSpecs),
    );

    const chapter2 = await db
      .select()
      .from(chapters)
      .where(and(eq(chapters.storyId, storyId), eq(chapters.chapterNumber, 2)));
    expect(chapter2).toHaveLength(1);
    const accepted = await db
      .select()
      .from(chapterRevisions)
      .where(
        and(
          eq(chapterRevisions.chapterId, chapter2[0].id),
          eq(chapterRevisions.status, "accepted"),
        ),
      );
    expect(accepted).toHaveLength(1);
    expect(accepted[0].title).toBe("First"); // first writer wins
    const snaps = await db
      .select()
      .from(continuitySnapshots)
      .where(
        and(
          eq(continuitySnapshots.storyId, storyId),
          eq(continuitySnapshots.afterChapterNumber, 2),
        ),
      );
    expect(snaps).toHaveLength(1);

    // The published revision carries EXACTLY the winner's specs — the loser's specs
    // were skipped entirely (author-only guard), so the immutable revision is clean.
    const publishedSpecs = await db
      .select()
      .from(illustrationSpecs)
      .where(eq(illustrationSpecs.revisionId, winner.revisionId))
      .orderBy(asc(illustrationSpecs.orderIndex));
    expect(publishedSpecs.map((s) => s.anchorKey)).toEqual([
      "winner-anchor-a",
      "winner-anchor-b",
    ]);
  });

  it("the hidden bible and future blueprints never reach a client payload", async () => {
    const user = await seedUser("m8-spoil");
    const familyId = await seedFamily(user, "Spoilers");
    const theia = await seedCharacter(familyId, "theia-s", "Theia");
    const juno = await seedCharacter(familyId, "juno-s", "Juno");
    const actor = ownerActor(user, familyId);
    const stack = buildStack(seriesScript());
    const { storyId, workflowId } = await stack.seriesCommands.createSeries(
      actor,
      baseCommand([theia, juno], "series-spoil"),
    );
    await drive(stack.engine, workflowId);

    const overview = await stack.seriesQueries.getSeriesOverview(
      actor,
      storyId,
    );
    const chapter = await stack.seriesQueries.getSeriesChapter(
      actor,
      storyId,
      1,
    );
    const storyRepository = createStoryRepository(db);
    const library = await storyRepository.listLibrary(familyId);

    // Inspect the FULL JSON of every client-facing read model for spoiler leaks.
    const blobs = [
      JSON.stringify(overview),
      JSON.stringify(chapter),
      JSON.stringify(library),
    ];
    for (const blob of blobs) {
      expect(blob).not.toContain("SECRET-SYNOPSIS");
      expect(blob).not.toContain("internalSynopsis");
      expect(blob).not.toContain("plannedEnding");
      expect(blob).not.toContain("chapterBlueprints");
      expect(blob).not.toContain("forbiddenDevelopments");
      expect(blob).not.toContain("pinnedRouteProfile");
    }
    // The spoiler-free premise IS present in the overview.
    expect(JSON.stringify(overview)).toContain(
      "Friends explore a glowing night forest",
    );
  });

  it("the next-chapter context resolves PINNED route versions, not the current active", async () => {
    const user = await seedUser("m8-pin");
    const familyId = await seedFamily(user, "Pinners");
    const theia = await seedCharacter(familyId, "theia-p", "Theia");
    const juno = await seedCharacter(familyId, "juno-p", "Juno");
    const actor = ownerActor(user, familyId);
    const stack = buildStack(seriesScript());
    const { storyId, workflowId } = await stack.seriesCommands.createSeries(
      actor,
      baseCommand([theia, juno], "series-pin"),
    );
    await drive(stack.engine, workflowId);

    const context = await stack.seriesRepository.getSeriesContext(storyId);
    const pinnedPlanningRoute =
      context!.pinnedRouteProfile["chapter-planning"]!;
    expect(pinnedPlanningRoute).toBeTruthy();

    // Change the ACTIVE chapter-planning route: deactivate the pinned one and add a
    // brand-new active version with a different id.
    await db
      .update(modelRouteVersions)
      .set({ lifecycleStatus: "deprecated" })
      .where(eq(modelRouteVersions.id, pinnedPlanningRoute));
    const newActiveId = "00000000-0000-4000-8000-00000000c0de";
    await db.insert(modelRouteVersions).values({
      id: newActiveId,
      capability: "chapter-planning",
      version: "2.0.0",
      primaryTarget: "anthropic/claude-sonnet-5",
      fallbacks: [],
      settings: { temperature: 0.5, maxOutputTokens: 4000 },
      lifecycleStatus: "active",
      evaluationProfile: null,
      approvalRecord: {
        approvedBy: "test",
        approvedAt: "2026-07-18T00:00:00Z",
      },
      isCanary: false,
      canaryRule: null,
    });

    // Generate chapter 2 — it must use the PINNED route, not the new active.
    const next = await stack.seriesCommands.continueSeries(actor, { storyId });
    await drive(stack.engine, next.workflowId);

    const planRuns = await db
      .select()
      .from(generationRuns)
      .where(
        and(
          eq(generationRuns.workflowId, next.workflowId),
          eq(generationRuns.capability, "chapter-planning"),
        ),
      );
    expect(planRuns.length).toBeGreaterThan(0);
    for (const run of planRuns) {
      expect(run.modelRouteVersionId).toBe(pinnedPlanningRoute);
      expect(run.modelRouteVersionId).not.toBe(newActiveId);
    }
  });

  it("stamps the ACTIVE image-route version into the series pins at creation (rule 8 / ADR-009)", async () => {
    const user = await seedUser("m8-imgpin");
    const familyId = await seedFamily(user, "ImagePinners");
    const theia = await seedCharacter(familyId, "theia-i", "Theia");
    const juno = await seedCharacter(familyId, "juno-i", "Juno");
    const actor = ownerActor(user, familyId);
    const stack = buildStack(seriesScript());
    const { storyId, workflowId } = await stack.seriesCommands.createSeries(
      actor,
      baseCommand([theia, juno], "series-imgpin"),
    );
    await drive(stack.engine, workflowId);

    expect(
      await stack.seriesRepository.getPinnedImageRouteVersion(storyId),
    ).toBe("mvp-image-routes-v2");
  });
});
