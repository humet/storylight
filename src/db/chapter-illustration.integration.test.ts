import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFilesystemObjectStorage } from "@/adapters/storage/filesystem-object-storage";
import { createFakeChapterImageModel } from "@/adapters/images/fake-chapter-image-model";
import { createFakeVisionModel } from "@/adapters/images/fake-vision-model";
import { createImageRouteRegistry } from "@/application/model-routes/image-route-registry";
import { createIllustrationService } from "@/application/illustration-service";
import type { VisionModel } from "@/application/ports/vision-model";
import {
  asWorkflowDefinition,
  createWorkflowEngine,
} from "@/application/workflow-engine";
import {
  createGenerateIllustrationWorkflow,
  GENERATE_ILLUSTRATION_TYPE,
} from "@/application/workflows/generate-illustration-workflow";
import type { AuthenticatedActor } from "@/domain/actor";
import type { CharacterProfilePayload } from "@/domain/character";
import type { VisionVerdict } from "@/domain/image-job";
import type { OneOffPlan } from "@/domain/story-draft";
import type { ReviewArtifact } from "@/domain/review-policy";
import type { Database } from "./client";
import { createCharacterRepository } from "./repositories/character-repository";
import { createFamilyRepository } from "./repositories/family-repository";
import { createIllustrationRepository } from "./repositories/illustration-repository";
import { createImageGenerationRunRepository } from "./repositories/image-generation-run-repository";
import { createSeriesRepository } from "./repositories/series-repository";
import { createStoryRepository } from "./repositories/story-repository";
import { createVisualAssetRepository } from "./repositories/visual-asset-repository";
import { createWorkflowRepository } from "./repositories/workflow-repository";
import { illustrationAssets, imageGenerationRuns, users } from "./schema";
import { createTestDatabase, type TestDatabase } from "./testing";

/**
 * Milestone 9 EXIT CRITERION (`docs/IMPLEMENTATION_PLAN.md`): approved text remains
 * readable while images process; rejected images are never returned; identity test
 * thresholds pass on synthetic characters. The full chapter-illustration pipeline
 * runs on the REAL engine + Drizzle repositories + deterministic FAKE image/vision
 * adapters + a filesystem object store against a migrated-from-empty PGlite. No
 * child production data, no paid provider call (AGENTS.md).
 */

const PLAN: OneOffPlan = {
  title: "The Lantern in the Garden",
  setting: "A small garden at dusk",
  protagonistKey: "rosa",
  protagonistDesire: "to find the way home",
  obstacle: "the path is dark",
  emotionalTheme: "gentle courage",
  beats: [{ key: "beat-1", description: "Rosa lifts the lantern" }],
  climax: "the lantern glows",
  resolution: "the path lights up",
  calmingClose: "Rosa walks home warm and safe",
};

const REVIEW: ReviewArtifact = {
  completeArc: true,
  resolvesCentralProblem: true,
  endsCalmly: true,
  sequelDependency: false,
  ageAppropriate: true,
  findings: [],
  summary: "A gentle, complete bedtime story.",
};

const CHARACTER_PAYLOAD: CharacterProfilePayload = {
  displayName: "Rosa",
  apparentAge: 6,
  pronouns: ["she", "her"],
  narrativeIdentity: {
    personalityTraits: [],
    strengths: ["gentle"],
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

const failingIdentity = (): VisionVerdict => ({
  identityByChild: [{ characterKey: "rosa", matches: false }],
  expectedCount: 1,
  observedCount: 1,
  outfitConsistent: true,
  propConsistent: true,
  toneAppropriate: true,
  styleConsistent: true,
});

let harness: TestDatabase;
let db: Database;
let storageDir: string;

beforeEach(async () => {
  harness = await createTestDatabase();
  db = harness.db;
  storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "storylight-m9-"));
});

afterEach(async () => {
  await harness.close();
  await fs.rm(storageDir, { recursive: true, force: true });
});

async function seedActor(name: string): Promise<AuthenticatedActor> {
  const userId = `user-${name}`;
  await db.insert(users).values({
    id: userId,
    name,
    email: `${name}@example.test`,
    emailVerified: true,
  });
  const { family } = await createFamilyRepository(db).createFamilyWithOwner({
    userId,
    familyName: name,
  });
  return { userId, familyIds: [family.id], roles: ["owner"] };
}

async function seedPublishedStory(actor: AuthenticatedActor) {
  const familyId = actor.familyIds[0];
  const characterRepo = createCharacterRepository(db);
  const character = await characterRepo.createCharacter({
    familyId,
    characterKey: "rosa-abcd1234",
    payload: CHARACTER_PAYLOAD,
  });
  await characterRepo.setStatus({
    familyId,
    characterId: character.id,
    status: "active",
    approvedAt: new Date(),
  });

  const storyRepo = createStoryRepository(db);
  const storyId = "00000000-0000-4000-8000-000000000001";
  await storyRepo.createStoryIfAbsent({
    id: storyId,
    familyId,
    userId: actor.userId,
    type: "one_off",
    generationInput: {
      storyId,
      characterIds: [character.id],
      idea: "A lantern",
      theme: null,
      length: "short",
      tone: "gentle",
    },
  });
  const { revisionId } = await storyRepo.publishOneOffChapter({
    familyId,
    storyId,
    workflowId: "seed-wf",
    title: PLAN.title,
    plan: PLAN,
    draftParagraphs: ["Rosa stood in the garden.", "She lifted the lantern."],
    wordCount: 8,
    schemaVersion: "chapter-draft.v1",
    review: { review: REVIEW, decision: "approve", revisionsUsed: 0 },
    illustrationSpecs: [
      {
        anchorKey: "anchor-1",
        afterParagraph: 1,
        caption: "Rosa lifts the glowing lantern",
        sceneDescription: "Rosa lifts a warm lantern in a dusky garden",
        aspect: "landscape",
        schemaVersion: "illustration-plan.v1",
        subjectCharacterIds: [character.id],
        prominentCharacterId: character.id,
      },
    ],
  });

  const illustrationRepo = createIllustrationRepository(db);
  const specIds = await illustrationRepo.listSpecIdsForChapterRevision(
    familyId,
    revisionId,
  );
  return { familyId, storyId, characterId: character.id, specId: specIds[0] };
}

function buildImageStack(vision: VisionModel) {
  const workflowRepo = createWorkflowRepository(db);
  const illustrationRepository = createIllustrationRepository(db);
  const imageRunRepository = createImageGenerationRunRepository(db);
  const def = asWorkflowDefinition(
    createGenerateIllustrationWorkflow({
      illustrationRepository,
      visualAssetRepository: createVisualAssetRepository(db),
      characterRepository: createCharacterRepository(db),
      seriesRepository: createSeriesRepository(db),
      chapterImageModel: createFakeChapterImageModel(),
      visionModel: vision,
      objectStorage: createFilesystemObjectStorage(storageDir),
      imageRunRepository,
      imageRouteRegistry: createImageRouteRegistry(),
    }),
  );
  const registry = { [def.type]: def };
  const engine = createWorkflowEngine({ repo: workflowRepo, registry });
  return { engine, workflowRepo, illustrationRepository, imageRunRepository };
}

async function runImageJob(
  actor: AuthenticatedActor,
  specId: string,
  vision: VisionModel,
  requestId: string,
) {
  const stack = buildImageStack(vision);
  const { execution } = await stack.workflowRepo.createOrGetExecution({
    familyId: actor.familyIds[0],
    userId: actor.userId,
    type: GENERATE_ILLUSTRATION_TYPE,
    requestId,
    entityId: specId,
    input: { specId },
    initialStage: "prepare",
  });
  const result = await stack.engine.runToCompletion(execution.id);
  return { ...stack, executionId: execution.id, result };
}

describe("chapter illustration pipeline (M9 exit)", () => {
  it("happy path: approves the original + an immutable revision, reader serves the approved original (ADR-007)", async () => {
    const actor = await seedActor("readers");
    const { familyId, storyId, specId } = await seedPublishedStory(actor);
    const objectStorage = createFilesystemObjectStorage(storageDir);
    const storyRepo = createStoryRepository(db);

    // Before the job runs, the reader shows the text with a PENDING image slot.
    const before = await storyRepo.getStoryReader(
      familyId,
      actor.userId,
      storyId,
    );
    expect(before?.paragraphs).toHaveLength(2);
    expect(before?.illustrations[0].status).toBe("pending");

    const run = await runImageJob(
      actor,
      specId,
      createFakeVisionModel(),
      "job-1",
    );
    expect(run.result.finalStatus).toBe("completed");

    // Publication approved; reader now serves the image.
    expect(
      await run.illustrationRepository.getPublicationState(familyId, specId),
    ).toBe("approved");
    const after = await storyRepo.getStoryReader(
      familyId,
      actor.userId,
      storyId,
    );
    expect(after?.illustrations[0].status).toBe("approved");
    expect(after?.paragraphs).toHaveLength(2); // text still fully readable

    // An immutable revision + exactly one approved asset: the ORIGINAL. ADR-007:
    // no derivatives are written — the approved original is what gets delivered.
    const assets = await db
      .select()
      .from(illustrationAssets)
      .where(eq(illustrationAssets.specId, specId));
    const approved = assets.filter((a) => a.state === "approved");
    expect(approved.every((a) => a.kind === "original")).toBe(true);
    expect(approved.filter((a) => a.kind === "original")).toHaveLength(1);
    expect(assets.some((a) => a.kind === "derivative")).toBe(false);

    // Delivery returns the approved original PNG for the approved spec.
    const service = createIllustrationService({
      familyRepository: createFamilyRepository(db),
      illustrationRepository: run.illustrationRepository,
      objectStorage,
    });
    const delivered = await service.resolveDeliverableIllustration(
      actor,
      specId,
    );
    expect(delivered).not.toBeNull();
    expect(delivered!.contentType).toBe("image/png");
    expect(delivered!.bytes.byteLength).toBeGreaterThan(0);
    // The delivered bytes are a real PNG (magic bytes).
    expect(Array.from(delivered!.bytes.subarray(0, 4))).toEqual([
      0x89, 0x50, 0x4e, 0x47,
    ]);

    // Cost/usage recorded: a generation run + a review run.
    const runs = await run.imageRunRepository.listRunsForWorkflow(
      run.executionId,
    );
    expect(runs.some((r) => r.kind === "generation")).toBe(true);
    expect(runs.some((r) => r.kind === "review")).toBe(true);
  });

  it("identity failure → repair → escalation → manual-pending; text still readable; delivery 404", async () => {
    const actor = await seedActor("identity");
    const { familyId, storyId, specId } = await seedPublishedStory(actor);
    const storyRepo = createStoryRepository(db);

    // A blocking identity mismatch every attempt: never approvable (rule 7).
    const vision = createFakeVisionModel({
      verdicts: [failingIdentity(), failingIdentity(), failingIdentity()],
    });
    const run = await runImageJob(actor, specId, vision, "job-fail");
    expect(run.result.finalStatus).toBe("completed");

    expect(
      await run.illustrationRepository.getPublicationState(familyId, specId),
    ).toBe("manual-review");

    // Reader shows a calm fallback but the TEXT is fully readable.
    const reader = await storyRepo.getStoryReader(
      familyId,
      actor.userId,
      storyId,
    );
    expect(reader?.illustrations[0].status).toBe("failed");
    expect(reader?.paragraphs).toHaveLength(2);

    // The quarantined originals are NEVER delivered.
    const service = createIllustrationService({
      familyRepository: createFamilyRepository(db),
      illustrationRepository: run.illustrationRepository,
      objectStorage: createFilesystemObjectStorage(storageDir),
    });
    expect(
      await service.resolveDeliverableIllustration(actor, specId),
    ).toBeNull();

    // Three generation attempts were made (initial + repair + escalation).
    const runs = await run.imageRunRepository.listRunsForWorkflow(
      run.executionId,
    );
    expect(runs.filter((r) => r.kind === "generation")).toHaveLength(3);
  });

  it("a quarantined original is unreachable via delivery (rule 9)", async () => {
    const actor = await seedActor("quarantine");
    const { familyId, specId } = await seedPublishedStory(actor);
    // No job run yet → no publication approved → nothing deliverable.
    const service = createIllustrationService({
      familyRepository: createFamilyRepository(db),
      illustrationRepository: createIllustrationRepository(db),
      objectStorage: createFilesystemObjectStorage(storageDir),
    });
    expect(
      await service.resolveDeliverableIllustration(actor, specId),
    ).toBeNull();
    void familyId;
  });

  it("regenerating an illustration mints revision 2 and retires the old approved assets", async () => {
    const actor = await seedActor("regen");
    const { familyId, specId } = await seedPublishedStory(actor);

    await runImageJob(actor, specId, createFakeVisionModel(), "job-a");
    const firstAssets = await db
      .select()
      .from(illustrationAssets)
      .where(eq(illustrationAssets.specId, specId));
    const firstApprovedOriginal = firstAssets.find(
      (a) => a.kind === "original" && a.state === "approved",
    );
    expect(firstApprovedOriginal).toBeDefined();

    // A regeneration is a NEW workflow for the same spec.
    const second = await runImageJob(
      actor,
      specId,
      createFakeVisionModel(),
      "job-b",
    );
    expect(second.result.finalStatus).toBe("completed");

    // The old original is retired; exactly one approved original remains.
    const afterAssets = await db
      .select()
      .from(illustrationAssets)
      .where(eq(illustrationAssets.specId, specId));
    const approvedOriginals = afterAssets.filter(
      (a) => a.kind === "original" && a.state === "approved",
    );
    expect(approvedOriginals).toHaveLength(1);
    expect(approvedOriginals[0].id).not.toBe(firstApprovedOriginal!.id);
    expect(
      afterAssets.some(
        (a) => a.id === firstApprovedOriginal!.id && a.state === "retired",
      ),
    ).toBe(true);

    // The publication is still approved and delivers the NEW image.
    expect(
      await second.illustrationRepository.getPublicationState(familyId, specId),
    ).toBe("approved");
  });

  it("re-driving an image workflow produces no duplicate assets or spend (idempotent)", async () => {
    const actor = await seedActor("idem");
    const { specId } = await seedPublishedStory(actor);

    const first = await runImageJob(
      actor,
      specId,
      createFakeVisionModel(),
      "job-idem",
    );
    const countAssets = async () =>
      (
        await db
          .select()
          .from(illustrationAssets)
          .where(eq(illustrationAssets.specId, specId))
      ).length;
    const assetsAfterFirst = await countAssets();
    const runsAfterFirst = (
      await db
        .select()
        .from(imageGenerationRuns)
        .where(eq(imageGenerationRuns.workflowId, first.executionId))
    ).length;

    // Re-drive the SAME workflow id (a crash/resume) — all stage outputs exist, so
    // handlers are skipped; deterministic ids collapse any re-record.
    const stack = buildImageStack(createFakeVisionModel());
    await stack.engine.runToCompletion(first.executionId);

    expect(await countAssets()).toBe(assetsAfterFirst);
    expect(
      (
        await db
          .select()
          .from(imageGenerationRuns)
          .where(eq(imageGenerationRuns.workflowId, first.executionId))
      ).length,
    ).toBe(runsAfterFirst);
  });

  it("one-off text regeneration supersedes the prior accepted revision (revision_number increments)", async () => {
    const actor = await seedActor("textregen");
    const { familyId, storyId } = await seedPublishedStory(actor);
    const storyRepo = createStoryRepository(db);

    await storyRepo.publishOneOffChapter({
      familyId,
      storyId,
      workflowId: "regen-wf",
      title: "The Lantern in the Garden (retold)",
      plan: PLAN,
      draftParagraphs: ["A brand new telling.", "With fresh words."],
      wordCount: 6,
      schemaVersion: "chapter-draft.v1",
      regenerate: true,
      review: { review: REVIEW, decision: "approve", revisionsUsed: 0 },
      illustrationSpecs: [],
    });

    // The reader now shows the NEW revision; the old one is superseded (retained).
    const reader = await storyRepo.getStoryReader(
      familyId,
      actor.userId,
      storyId,
    );
    expect(reader?.title).toBe("The Lantern in the Garden (retold)");
    expect(reader?.paragraphs).toEqual([
      "A brand new telling.",
      "With fresh words.",
    ]);
  });
});
