import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFakeLanguageModel } from "@/adapters/ai/fake-language-model";
import type {
  FakeModelResponse,
  FakeScript,
} from "@/adapters/ai/fake-language-model";
import { createStructuredGenerator } from "@/application/ai/generate-structured";
import { createModelRegistry } from "@/application/model-routes/model-registry";
import { createModelPricing } from "@/application/model-routes/pricing";
import { createStoryCommands } from "@/application/story-commands";
import { createStoryQueries } from "@/application/story-queries";
import { createWorkflowEngine } from "@/application/workflow-engine";
import { createWorkflowRegistry } from "@/application/workflow-registry";
import { createWorkflowService } from "@/application/workflow-service";
import type { AuthenticatedActor } from "@/domain/actor";
import type { CharacterProfilePayload } from "@/domain/character";
import type { LanguageModelRequest } from "@/application/ports/language-model";
import type { Database } from "./client";
import { createCharacterRepository } from "./repositories/character-repository";
import { createFamilyRepository } from "./repositories/family-repository";
import { createGenerationRunRepository } from "./repositories/generation-run-repository";
import { createModelRouteRepository } from "./repositories/model-route-repository";
import { createStoryRepository } from "./repositories/story-repository";
import { createWorkflowRepository } from "./repositories/workflow-repository";
import {
  chapterPublications,
  chapterRevisions,
  chapters,
  readingProgress,
  stories,
  users,
} from "./schema";
import { createTestDatabase, type TestDatabase } from "./testing";

/**
 * Milestone 7 EXIT CRITERION (`docs/IMPLEMENTATION_PLAN.md`): "a parent can create
 * and read an approved one-off story; safety and failed-review fixtures pass". The
 * whole one-off pipeline runs on the REAL engine + Drizzle repositories + a FAKE
 * language adapter (believable fixtures) against a migrated-from-empty PGlite. No
 * child production data is used, and no paid provider call is made (AGENTS.md).
 */

// --- Believable fixtures ------------------------------------------------

const PLAN = {
  schemaVersion: "one-off-plan.v1",
  title: "The Lantern in the Garden",
  setting: "A small garden behind Rosa's house, glowing at dusk",
  protagonistKey: "rosa",
  protagonistDesire: "to find her way back to the warm kitchen door",
  obstacle: "the garden has grown dark and the path is hard to see",
  emotionalTheme: "finding courage in small, gentle steps",
  beats: [
    { key: "beat-1", description: "Rosa notices the garden has gone dark" },
    { key: "beat-2", description: "She spots an old lantern on the wall" },
    { key: "beat-3", description: "She lifts it down and it glows softly" },
    { key: "beat-4", description: "A firefly comes to keep her company" },
    { key: "beat-5", description: "Together they follow the winding path" },
    { key: "beat-6", description: "They reach the warm kitchen door" },
    { key: "beat-7", description: "Rosa thanks the firefly and goes inside" },
  ],
  climax:
    "The path forks and, for a moment, Rosa cannot tell which way is home",
  resolution: "The firefly drifts ahead and lights the gentler path",
  calmingClose: "Rosa curls up by the window, watching the lantern glow fade",
};

const PARAGRAPH =
  "Rosa stepped softly onto the cool grass and looked around the quiet garden. The evening had folded itself over the flowers, and everything felt hushed and kind. She took one small breath and then another, letting the calm settle into her shoulders like a warm blanket.";

function makeDraft(beatKeys: string[]) {
  // ~8 paragraphs of the sample (~45 words each → ~360... double it for the band).
  const paragraphs = Array.from({ length: 12 }, () => PARAGRAPH);
  return {
    schemaVersion: "chapter-draft.v1",
    title: "The Lantern in the Garden",
    paragraphs,
    beatsCovered: beatKeys,
    illustrationAnchors: [
      {
        key: "anchor-1",
        afterParagraph: 1,
        description: "Rosa in the dark garden",
      },
      {
        key: "anchor-2",
        afterParagraph: 6,
        description: "The firefly lights the path",
      },
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
  summary: "A gentle, complete story that resolves kindly and ends calmly.",
};

const REVIEW_REVISE = {
  ...REVIEW_CLEAN,
  findings: [
    {
      code: "excessive_suspense",
      severity: "major",
      note: "the fork is a touch tense",
    },
  ],
  summary:
    "Lovely, but the middle is a little tense for the youngest listeners.",
};

const REVIEW_BLOCK = {
  ...REVIEW_CLEAN,
  ageAppropriate: false,
  findings: [
    {
      code: "graphic_injury",
      severity: "blocking",
      note: "a character is badly hurt",
    },
  ],
  summary: "Contains a graphic injury unsuitable for a bedtime story.",
};

const ILLUSTRATION = {
  schemaVersion: "illustration-plan.v1",
  illustrations: [
    {
      anchorKey: "anchor-1",
      caption: "Rosa stands in the dim, glowing garden.",
      sceneDescription: "A small child in a garden at dusk, soft warm light.",
      aspect: "landscape",
    },
    {
      anchorKey: "anchor-2",
      caption: "A firefly lights the winding path home.",
      sceneDescription: "A firefly glowing above a garden path at night.",
      aspect: "landscape",
    },
  ],
};

/** A fixture dispatcher keyed by wire-schema name; reviews are consumed in order. */
function fixtureScript(reviews: object[]): FakeScript {
  let reviewIndex = 0;
  return (request: LanguageModelRequest): FakeModelResponse => {
    const text = (value: unknown): FakeModelResponse => ({
      kind: "text",
      text: JSON.stringify(value),
    });
    switch (request.schemaName) {
      case "StorylightOneOffPlan":
        return text(PLAN);
      case "StorylightChapterDraft":
        return text(makeDraft(PLAN.beats.map((b) => b.key)));
      case "StorylightChapterReview": {
        const review = reviews[Math.min(reviewIndex, reviews.length - 1)];
        reviewIndex += 1;
        return text(review);
      }
      case "StorylightIllustrationPlan":
        return text(ILLUSTRATION);
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

const CHARACTER_PAYLOAD: CharacterProfilePayload = {
  displayName: "Rosa",
  apparentAge: 6,
  pronouns: ["she", "her"],
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

async function seedActiveCharacter(familyId: string): Promise<string> {
  const repo = createCharacterRepository(db);
  const created = await repo.createCharacter({
    familyId,
    characterKey: "rosa-test0001",
    payload: CHARACTER_PAYLOAD,
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
  const characterRepository = createCharacterRepository(db);
  const modelRegistry = createModelRegistry(createModelRouteRepository(db));
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
  });
  const engine = createWorkflowEngine({ repo: workflowRepo, registry });
  const service = createWorkflowService({
    familyRepository: familyRepo,
    workflowRepository: workflowRepo,
    registry,
    dispatcher: { async dispatch() {} },
  });
  const storyCommands = createStoryCommands({
    familyRepository: familyRepo,
    storyRepository,
    characterRepository,
    workflowService: service,
  });
  const storyQueries = createStoryQueries({
    familyRepository: familyRepo,
    storyRepository,
    characterRepository,
  });
  return { engine, storyCommands, storyQueries, storyRepository, workflowRepo };
}

beforeEach(async () => {
  harness = await createTestDatabase();
  db = harness.db;
  familyRepo = createFamilyRepository(db);
});

afterEach(async () => {
  await harness.close();
});

const baseCommand = (characterId: string, requestId: string) => ({
  requestId,
  idea: "A story about Rosa finding her way home in a dark garden",
  characterIds: [characterId],
  length: "standard" as const,
  tone: "gentle" as const,
  theme: null,
});

describe("M7 one-off story pipeline", () => {
  it("happy path: publishes exactly one accepted revision a parent can read", async () => {
    const user = await seedUser("m7-happy");
    const familyId = await seedFamily(user, "Readers");
    const characterId = await seedActiveCharacter(familyId);
    const actor = ownerActor(user, familyId);
    const { engine, storyCommands, storyQueries } = buildStack(
      fixtureScript([REVIEW_CLEAN]),
    );

    const { storyId, workflowId } = await storyCommands.createOneOffStory(
      actor,
      baseCommand(characterId, "story-1"),
    );
    const drive = await engine.runToCompletion(workflowId, {
      sleep: async () => {},
    });
    expect(drive.finalStatus).toBe("completed");

    // Exactly ONE accepted revision.
    const accepted = await db
      .select()
      .from(chapterRevisions)
      .where(
        and(
          eq(chapterRevisions.storyId, storyId),
          eq(chapterRevisions.status, "accepted"),
        ),
      );
    expect(accepted).toHaveLength(1);
    expect(accepted[0].revisionNumber).toBe(1);

    // Exactly one publication + story published.
    const pubs = await db
      .select()
      .from(chapterPublications)
      .where(eq(chapterPublications.storyId, storyId));
    expect(pubs).toHaveLength(1);
    const [story] = await db
      .select()
      .from(stories)
      .where(eq(stories.id, storyId));
    expect(story.status).toBe("published");
    expect(story.title).toBe(PLAN.title);

    // The reader returns the accepted content with illustration slots.
    const reader = await storyQueries.getStoryReader(actor, storyId);
    expect(reader).not.toBeNull();
    expect(reader!.title).toBe(PLAN.title);
    expect(reader!.paragraphs.length).toBeGreaterThan(3);
    expect(reader!.illustrations).toHaveLength(2);
    expect(reader!.illustrations[0].anchorKey).toBe("anchor-1");
  });

  it("one-off reading progress round-trips and upserts to ONE row (per-chapter unique regression)", async () => {
    // Regression guard for the reading_progress uniqueness change (now
    // UNIQUE(story_id, chapter_id, user_id)): a one-off has a single chapter, so
    // progress still behaves as one row per (story, reader) and re-saving updates
    // rather than duplicating.
    const user = await seedUser("m7-progress");
    const familyId = await seedFamily(user, "Readers");
    const characterId = await seedActiveCharacter(familyId);
    const actor = ownerActor(user, familyId);
    const { engine, storyCommands, storyRepository } = buildStack(
      fixtureScript([REVIEW_CLEAN]),
    );

    const { storyId, workflowId } = await storyCommands.createOneOffStory(
      actor,
      baseCommand(characterId, "story-progress"),
    );
    await engine.runToCompletion(workflowId, { sleep: async () => {} });

    // Save, then re-save with a new position — the second call must UPDATE the row.
    await storyCommands.saveReadingProgress(actor, {
      storyId,
      scrollProportion: 0.25,
      paragraphAnchor: 2,
      completed: false,
    });
    await storyCommands.saveReadingProgress(actor, {
      storyId,
      scrollProportion: 0.8,
      paragraphAnchor: 6,
      completed: true,
    });

    const rows = await db
      .select()
      .from(readingProgress)
      .where(
        and(
          eq(readingProgress.storyId, storyId),
          eq(readingProgress.userId, user),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0].chapterId).not.toBeNull();
    expect(rows[0].paragraphAnchor).toBe(6);
    expect(rows[0].completed).toBe(true);

    const progress = await storyRepository.getReadingProgress(
      familyId,
      user,
      storyId,
    );
    expect(progress?.paragraphAnchor).toBe(6);
    expect(progress?.completed).toBe(true);
  });

  it("revision loop: revises once then approves and publishes", async () => {
    const user = await seedUser("m7-revise");
    const familyId = await seedFamily(user, "Revisers");
    const characterId = await seedActiveCharacter(familyId);
    const actor = ownerActor(user, familyId);
    const { engine, storyCommands, storyQueries } = buildStack(
      fixtureScript([REVIEW_REVISE, REVIEW_CLEAN]),
    );

    const { storyId, workflowId } = await storyCommands.createOneOffStory(
      actor,
      baseCommand(characterId, "story-revise"),
    );
    const drive = await engine.runToCompletion(workflowId, {
      sleep: async () => {},
    });
    expect(drive.finalStatus).toBe("completed");

    const accepted = await db
      .select()
      .from(chapterRevisions)
      .where(
        and(
          eq(chapterRevisions.storyId, storyId),
          eq(chapterRevisions.status, "accepted"),
        ),
      );
    expect(accepted).toHaveLength(1);
    expect(accepted[0].reviewSnapshot?.revisionsUsed).toBe(1);
    expect(await storyQueries.getStoryReader(actor, storyId)).not.toBeNull();
  });

  it("revision cap: two revisions still failing dead-letters safely, nothing published", async () => {
    const user = await seedUser("m7-cap");
    const familyId = await seedFamily(user, "Cappers");
    const characterId = await seedActiveCharacter(familyId);
    const actor = ownerActor(user, familyId);
    // Every review asks to revise → after two revisions the policy fails safely.
    const { engine, storyCommands, storyQueries, workflowRepo } = buildStack(
      fixtureScript([REVIEW_REVISE]),
    );

    const { storyId, workflowId } = await storyCommands.createOneOffStory(
      actor,
      baseCommand(characterId, "story-cap"),
    );
    const drive = await engine.runToCompletion(workflowId, {
      sleep: async () => {},
    });
    expect(drive.finalStatus).toBe("failed");

    const dead = await workflowRepo.getExecutionById(workflowId);
    expect(dead?.lastError?.code).toBe("GENERATION_FAILED");

    const [story] = await db
      .select()
      .from(stories)
      .where(eq(stories.id, storyId));
    expect(story.status).toBe("failed");

    // Nothing publishable persisted.
    expect(
      await db
        .select()
        .from(chapterRevisions)
        .where(eq(chapterRevisions.storyId, storyId)),
    ).toHaveLength(0);
    expect(await storyQueries.getStoryReader(actor, storyId)).toBeNull();
  });

  it("safety block: a blocking review publishes nothing and dead-letters with SAFETY_REJECTION", async () => {
    const user = await seedUser("m7-block");
    const familyId = await seedFamily(user, "Blockers");
    const characterId = await seedActiveCharacter(familyId);
    const actor = ownerActor(user, familyId);
    const { engine, storyCommands, storyQueries, workflowRepo } = buildStack(
      fixtureScript([REVIEW_BLOCK]),
    );

    const { storyId, workflowId } = await storyCommands.createOneOffStory(
      actor,
      baseCommand(characterId, "story-block"),
    );
    const drive = await engine.runToCompletion(workflowId, {
      sleep: async () => {},
    });
    expect(drive.finalStatus).toBe("failed");

    const dead = await workflowRepo.getExecutionById(workflowId);
    expect(dead?.lastError?.code).toBe("SAFETY_REJECTION");
    expect(dead?.lastError?.retryable).toBe(false);

    const [story] = await db
      .select()
      .from(stories)
      .where(eq(stories.id, storyId));
    expect(story.status).toBe("blocked");

    // No chapter, revision, or publication exists — nothing publishable persisted.
    expect(
      await db.select().from(chapters).where(eq(chapters.storyId, storyId)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(chapterRevisions)
        .where(eq(chapterRevisions.storyId, storyId)),
    ).toHaveLength(0);
    // The reader never surfaces a blocked story.
    expect(await storyQueries.getStoryReader(actor, storyId)).toBeNull();
    // The library never lists a blocked story.
    const library = await storyQueries.getLibrary(actor);
    expect(library.find((s) => s.id === storyId)).toBeUndefined();
  });

  it("duplicate concurrent create resolves to ONE story and workflow (requestId idempotency)", async () => {
    const user = await seedUser("m7-dupe");
    const familyId = await seedFamily(user, "Dupers");
    const characterId = await seedActiveCharacter(familyId);
    const actor = ownerActor(user, familyId);
    const { storyCommands } = buildStack(fixtureScript([REVIEW_CLEAN]));

    const command = baseCommand(characterId, "story-dupe");
    const [a, b] = await Promise.all([
      storyCommands.createOneOffStory(actor, command),
      storyCommands.createOneOffStory(actor, command),
    ]);
    expect(a.storyId).toBe(b.storyId);
    expect(a.workflowId).toBe(b.workflowId);

    const rows = await db
      .select()
      .from(stories)
      .where(eq(stories.familyId, familyId));
    expect(rows).toHaveLength(1);
  });

  it("reader never returns a non-accepted current revision", async () => {
    const user = await seedUser("m7-reject");
    const familyId = await seedFamily(user, "Rejecters");
    const characterId = await seedActiveCharacter(familyId);
    const actor = ownerActor(user, familyId);
    const { engine, storyCommands, storyQueries } = buildStack(
      fixtureScript([REVIEW_CLEAN]),
    );

    const { storyId, workflowId } = await storyCommands.createOneOffStory(
      actor,
      baseCommand(characterId, "story-reject"),
    );
    await engine.runToCompletion(workflowId, { sleep: async () => {} });
    expect(await storyQueries.getStoryReader(actor, storyId)).not.toBeNull();

    // Simulate a rejected revision becoming the chapter's current pointer: the
    // reader must refuse to surface it (only an ACCEPTED current revision reads).
    const [chapter] = await db
      .select()
      .from(chapters)
      .where(eq(chapters.storyId, storyId));
    await db
      .update(chapterRevisions)
      .set({ status: "rejected" })
      .where(eq(chapterRevisions.id, chapter.currentRevisionId!));

    expect(await storyQueries.getStoryReader(actor, storyId)).toBeNull();
  });

  it("resume after a lost publish output re-publishes idempotently (one accepted revision)", async () => {
    const user = await seedUser("m7-resume");
    const familyId = await seedFamily(user, "Resumers");
    const characterId = await seedActiveCharacter(familyId);
    const actor = ownerActor(user, familyId);

    const first = buildStack(fixtureScript([REVIEW_CLEAN]));
    const { storyId, workflowId } = await first.storyCommands.createOneOffStory(
      actor,
      baseCommand(characterId, "story-resume"),
    );
    await first.engine.runToCompletion(workflowId, { sleep: async () => {} });

    // Simulate a crash: the publish side effects committed but its stage output
    // was lost, so the engine re-drives the publish stage.
    const { workflowStageOutputs, workflowExecutions } =
      await import("./schema");
    await db
      .delete(workflowStageOutputs)
      .where(eq(workflowStageOutputs.stageKey, "publish"));
    await db
      .update(workflowExecutions)
      .set({
        status: "waiting",
        currentStage: "publish",
        leaseOwner: null,
        leaseExpiresAt: null,
        completedAt: null,
      })
      .where(eq(workflowExecutions.id, workflowId));

    const second = buildStack(fixtureScript([REVIEW_CLEAN]));
    const redrive = await second.engine.runToCompletion(workflowId, {
      sleep: async () => {},
    });
    expect(redrive.finalStatus).toBe("completed");

    // Still exactly one accepted revision and one publication.
    const accepted = await db
      .select()
      .from(chapterRevisions)
      .where(
        and(
          eq(chapterRevisions.storyId, storyId),
          eq(chapterRevisions.status, "accepted"),
        ),
      );
    expect(accepted).toHaveLength(1);
    const pubs = await db
      .select()
      .from(chapterPublications)
      .where(eq(chapterPublications.storyId, storyId));
    expect(pubs).toHaveLength(1);
  });
});
