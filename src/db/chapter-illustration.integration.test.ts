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
import {
  illustrationAssets,
  illustrationRevisions,
  imageGenerationRuns,
  seriesBibles,
  users,
} from "./schema";
import type { SeriesBible } from "@/domain/series-bible";
import type { StoryDna } from "@/domain/story-dna";
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

/**
 * A NON-blocking failure (correct identity + count, but outfit continuity broken):
 * `decideImageReview` advances the ladder (initial → repair) without ever being a
 * blocking rule-7 failure, so a subsequent approving verdict can approve.
 */
const failingOutfit = (): VisionVerdict => ({
  identityByChild: [{ characterKey: "rosa", matches: true }],
  expectedCount: 1,
  observedCount: 1,
  outfitConsistent: false,
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

/**
 * Seed a published SERIES chapter with one illustration spec (ADR-009 per-series
 * image-route pinning). `pinnedImageRouteVersion` is stamped onto the series bible;
 * pass null to simulate a (post-backfill impossible) series with no pin — the
 * illustration job must fail LOUDLY rather than paint it with the active route.
 * Only the pin columns are read by the illustration job, so the bible/DNA are
 * minimal stubs.
 */
async function seedPublishedSeriesStory(
  actor: AuthenticatedActor,
  pinnedImageRouteVersion: string | null,
) {
  const familyId = actor.familyIds[0];
  const characterRepo = createCharacterRepository(db);
  const character = await characterRepo.createCharacter({
    familyId,
    characterKey: "rosa-series01",
    payload: CHARACTER_PAYLOAD,
  });
  await characterRepo.setStatus({
    familyId,
    characterId: character.id,
    status: "active",
    approvedAt: new Date(),
  });

  const storyRepo = createStoryRepository(db);
  const storyId = "00000000-0000-4000-8000-0000000000c1";
  await storyRepo.createStoryIfAbsent({
    id: storyId,
    familyId,
    userId: actor.userId,
    type: "series",
    generationInput: {
      storyId,
      characterIds: [character.id],
      idea: "A pinned series",
      theme: null,
      length: "short",
      tone: "gentle",
    },
  });

  if (pinnedImageRouteVersion) {
    await db.insert(seriesBibles).values({
      storyId,
      familyId,
      schemaVersion: "series-bible.v1",
      title: "Pinned Series",
      spoilerFreePremise: "A gentle pinned series.",
      chapterCount: 5,
      bible: {} as unknown as SeriesBible,
      storyDna: {} as unknown as StoryDna,
      pinnedRouteProfile: {},
      pinnedPromptVersions: {},
      pinnedSchemaVersions: [],
      pinnedVisualProfiles: {},
      pinnedImageRouteVersion,
    });
  }

  const { revisionId } = await storyRepo.publishOneOffChapter({
    familyId,
    storyId,
    workflowId: "seed-series-wf",
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

/**
 * Image-run rows straight from the table — the port's read model (ImageRunRecord)
 * omits routeVersion/target, which the ADR-009 pinning assertions need.
 */
async function imageRunsFor(workflowId: string) {
  return db
    .select({
      routeVersion: imageGenerationRuns.routeVersion,
      target: imageGenerationRuns.target,
      kind: imageGenerationRuns.kind,
    })
    .from(imageGenerationRuns)
    .where(eq(imageGenerationRuns.workflowId, workflowId));
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

    // Cost/usage recorded: a generation run + a review run. The initial phase
    // approved, so the repair + escalation stages short-circuited to no-ops —
    // EXACTLY ONE image generation happened (one image call per engine stage).
    const runs = await run.imageRunRepository.listRunsForWorkflow(
      run.executionId,
    );
    expect(runs.filter((r) => r.kind === "generation")).toHaveLength(1);
    expect(runs.filter((r) => r.kind === "review")).toHaveLength(1);
  });

  it("repair path: initial non-blocking failure → repair approves → escalation short-circuits (2 image calls)", async () => {
    const actor = await seedActor("repair");
    const { familyId, storyId, specId } = await seedPublishedStory(actor);
    const storyRepo = createStoryRepository(db);

    // Initial review reports a non-blocking outfit break → targeted repair; the
    // repair phase's review then approves (the fake's default approving verdict).
    const vision = createFakeVisionModel({ verdicts: [failingOutfit()] });
    const run = await runImageJob(actor, specId, vision, "job-repair");
    expect(run.result.finalStatus).toBe("completed");

    // The repaired image is approved and the reader serves it.
    expect(
      await run.illustrationRepository.getPublicationState(familyId, specId),
    ).toBe("approved");
    const reader = await storyRepo.getStoryReader(
      familyId,
      actor.userId,
      storyId,
    );
    expect(reader?.illustrations[0].status).toBe("approved");
    expect(reader?.paragraphs).toHaveLength(2);

    // EXACTLY two generations (initial + repair); the escalation phase was a
    // no-op because the repair phase approved — one image call per engine stage.
    const runs = await run.imageRunRepository.listRunsForWorkflow(
      run.executionId,
    );
    expect(runs.filter((r) => r.kind === "generation")).toHaveLength(2);
    expect(runs.filter((r) => r.kind === "review")).toHaveLength(2);
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

  it("(ADR-009) a SERIES resolves its PINNED image-route version end-to-end: run rows + publication record the pin (differs from active); review floats to active", async () => {
    const actor = await seedActor("series-pin");
    // Pin to v1 (all-Gemini) — DIFFERENT from the active v2 (Seedream). This is a
    // series created before the route swap; it must not drift to Seedream.
    const { familyId, specId } = await seedPublishedSeriesStory(
      actor,
      "mvp-image-routes-v1",
    );

    const run = await runImageJob(
      actor,
      specId,
      createFakeVisionModel(),
      "job-series-pin",
    );
    expect(run.result.finalStatus).toBe("completed");
    expect(
      await run.illustrationRepository.getPublicationState(familyId, specId),
    ).toBe("approved");

    // Provenance FIX: the immutable revision records the PINNED GENERATION version
    // (v1), NOT the review route's (active) version.
    const [revision] = await db
      .select({ imageRouteVersion: illustrationRevisions.imageRouteVersion })
      .from(illustrationRevisions)
      .where(eq(illustrationRevisions.specId, specId));
    expect(revision.imageRouteVersion).toBe("mvp-image-routes-v1");

    const runs = await imageRunsFor(run.executionId);
    // The generation run resolved the PINNED v1 routine target (gemini-flash),
    // NOT the active v2 target (Seedream).
    const generation = runs.filter((r) => r.kind === "generation");
    expect(generation).toHaveLength(1);
    expect(generation[0].routeVersion).toBe("mvp-image-routes-v1");
    expect(generation[0].target).toBe("google/gemini-3.1-flash-image");
    // The review run FLOATED to the active version (v2) — review is upgradeable.
    const review = runs.filter((r) => r.kind === "review");
    expect(review[0].routeVersion).toBe("mvp-image-routes-v2");
  });

  it("(ADR-009) a backfilled series pinned to the CURRENT active version (v2) resolves v2 (Seedream) generation targets", async () => {
    const actor = await seedActor("series-v2");
    const { familyId, specId } = await seedPublishedSeriesStory(
      actor,
      "mvp-image-routes-v2",
    );
    const run = await runImageJob(
      actor,
      specId,
      createFakeVisionModel(),
      "job-series-v2",
    );
    expect(
      await run.illustrationRepository.getPublicationState(familyId, specId),
    ).toBe("approved");
    const generation = (await imageRunsFor(run.executionId)).filter(
      (r) => r.kind === "generation",
    );
    expect(generation[0].routeVersion).toBe("mvp-image-routes-v2");
    expect(generation[0].target).toBe("bytedance/seedream-5.0-pro");
  });

  it("(ADR-009) a ONE-OFF resolves + records the ACTIVE image-route version (Seedream v2)", async () => {
    const actor = await seedActor("oneoff-active");
    const { familyId, specId } = await seedPublishedStory(actor);
    const run = await runImageJob(
      actor,
      specId,
      createFakeVisionModel(),
      "job-oneoff-active",
    );
    expect(
      await run.illustrationRepository.getPublicationState(familyId, specId),
    ).toBe("approved");

    const [revision] = await db
      .select({ imageRouteVersion: illustrationRevisions.imageRouteVersion })
      .from(illustrationRevisions)
      .where(eq(illustrationRevisions.specId, specId));
    expect(revision.imageRouteVersion).toBe("mvp-image-routes-v2");

    const generation = (await imageRunsFor(run.executionId)).filter(
      (r) => r.kind === "generation",
    );
    expect(generation[0].routeVersion).toBe("mvp-image-routes-v2");
    expect(generation[0].target).toBe("bytedance/seedream-5.0-pro");
  });

  it("(ADR-009) a SERIES with NO pinned image-route version fails LOUDLY (never silently paints with the active route)", async () => {
    const actor = await seedActor("series-nopin");
    // A series story with NO bible row ⇒ no pinned image-route version.
    const { familyId, specId } = await seedPublishedSeriesStory(actor, null);

    const run = await runImageJob(
      actor,
      specId,
      createFakeVisionModel(),
      "job-series-nopin",
    );
    // The prepare stage throws a non-retryable error → the workflow fails; no
    // image is generated and no spend is recorded.
    expect(run.result.finalStatus).toBe("failed");
    expect(
      await run.illustrationRepository.getPublicationState(familyId, specId),
    ).toBe("pending");
    const generation = (
      await run.imageRunRepository.listRunsForWorkflow(run.executionId)
    ).filter((r) => r.kind === "generation");
    expect(generation).toHaveLength(0);
  });
});
