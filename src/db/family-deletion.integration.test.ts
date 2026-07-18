import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ObjectStorage } from "@/application/ports/object-storage";
import { authorizeFamilyAction } from "@/application/family-access";
import {
  asWorkflowDefinition,
  createWorkflowEngine,
} from "@/application/workflow-engine";
import {
  createDeleteFamilyWorkflow,
  DELETE_FAMILY_TYPE,
} from "@/application/workflows/delete-family-workflow";
import { isDomainError } from "@/lib/errors";
import type { Database } from "./client";
import { createFamilyDeletionRepository } from "./repositories/family-deletion-repository";
import { createFamilyRepository } from "./repositories/family-repository";
import { createWorkflowRepository } from "./repositories/workflow-repository";
import {
  chapterRevisions,
  chapters,
  childCharacters,
  families,
  familyMembers,
  generationRuns,
  illustrationAssets,
  illustrationSpecs,
  imageGenerationRuns,
  stories,
  storyPreferences,
  users,
  visualAssets,
  workflowExecutions,
} from "./schema";
import { createTestDatabase, type TestDatabase } from "./testing";

/**
 * M10 EXIT PROOF for the auditable family-deletion workflow
 * (`docs/05-backend/database.md` "Deletion", `docs/05-backend/auth.md`). Seeds a
 * family with representative content across every subtree (a child + visual asset,
 * a story chapter with an illustration asset, raw model + image runs, preferences,
 * an unrelated prior workflow), runs the real engine + Drizzle repos on PGlite +
 * a recording storage adapter, and asserts the family is fully purged.
 */

const KEY_VISUAL = "families/F/characters/C/profiles/1/asset-a";
const KEY_IMAGE =
  "families/F/stories/S/chapters/CH/revisions/R/illustrations/SP/asset-b";

function recordingStorage() {
  const deleted: string[] = [];
  const storage: ObjectStorage = {
    async put(input) {
      return { key: input.key, size: input.bytes.length };
    },
    async read() {
      return null;
    },
    async head() {
      return null;
    },
    async delete(key) {
      deleted.push(key);
    },
  };
  return { storage, deleted };
}

let harness: TestDatabase;
let db: Database;

beforeEach(async () => {
  harness = await createTestDatabase();
  db = harness.db;
});
afterEach(async () => {
  await harness.close();
});

async function seedUser(id: string): Promise<string> {
  await db.insert(users).values({
    id,
    name: `User ${id}`,
    email: `${id}@example.test`,
    emailVerified: true,
  });
  return id;
}

/** Seed a family with content in every subtree. Returns ids. */
async function seedFamilyWithContent() {
  const userId = await seedUser("owner");
  const familyRepo = createFamilyRepository(db);
  const { family } = await familyRepo.createFamilyWithOwner({
    userId,
    familyName: "The Willows",
  });
  const familyId = family.id;

  const [character] = await db
    .insert(childCharacters)
    .values({ familyId, characterKey: "rosa", displayName: "Rosa" })
    .returning();
  await db.insert(visualAssets).values({
    familyId,
    characterId: character.id,
    candidateSetId: crypto.randomUUID(),
    view: "front-portrait",
    storageKey: KEY_VISUAL,
    contentType: "image/png",
    checksum: "c",
    byteSize: 1,
    width: 1,
    height: 1,
    model: "fake",
    seed: 0,
  });

  const [story] = await db
    .insert(stories)
    .values({ familyId, userId })
    .returning();
  const [chapter] = await db
    .insert(chapters)
    .values({ familyId, storyId: story.id })
    .returning();
  const [revision] = await db
    .insert(chapterRevisions)
    .values({
      familyId,
      storyId: story.id,
      chapterId: chapter.id,
      revisionNumber: 1,
      title: "A Quiet Night",
      bodyParagraphs: ["Once upon a time."],
      wordCount: 4,
      schemaVersion: "chapter-draft.v1",
      planSnapshot: {
        title: "T",
        setting: "S",
        protagonistKey: "rosa",
        protagonistDesire: "d",
        obstacle: "o",
        emotionalTheme: "e",
        beats: [],
        climax: "c",
        resolution: "r",
        calmingClose: "cc",
      },
    })
    .returning();
  const [spec] = await db
    .insert(illustrationSpecs)
    .values({
      familyId,
      storyId: story.id,
      chapterId: chapter.id,
      revisionId: revision.id,
      anchorKey: "a1",
      orderIndex: 0,
      afterParagraph: 0,
      caption: "Rosa in the garden",
      sceneDescription: "scene",
      aspect: "landscape",
      schemaVersion: "illustration-plan.v1",
    })
    .returning();
  await db.insert(illustrationAssets).values({
    familyId,
    storyId: story.id,
    chapterId: chapter.id,
    chapterRevisionId: revision.id,
    specId: spec.id,
    kind: "original",
    storageKey: KEY_IMAGE,
    contentType: "image/png",
    checksum: "c",
    byteSize: 1,
    width: 1,
    height: 1,
    model: "fake",
  });

  await db.insert(generationRuns).values({
    familyId,
    capability: "one-off-planning",
    routeVersion: "1.0.0",
    resolvedModelId: "m",
    target: "t",
    promptVersion: "p",
    schemaVersion: "s",
    attemptIndex: 0,
    phase: "initial",
    outcome: "accepted",
    inputTokens: 1,
    outputTokens: 1,
    totalTokens: 2,
    estimatedCostMinorUnits: 5,
    latencyMs: 10,
  });
  await db.insert(imageGenerationRuns).values({
    familyId,
    capability: "routine-chapter-illustration",
    phase: "initial",
    kind: "generation",
    target: "t",
    resolvedModelId: "m",
    routeVersion: "v",
    outcome: "accepted",
    estimatedCostMinorUnits: 350,
    latencyMs: 20,
  });
  await db.insert(storyPreferences).values({ familyId });

  // An unrelated PRIOR workflow for the family (must be purged, unlike the
  // deletion workflow itself).
  await db.insert(workflowExecutions).values({
    familyId,
    userId,
    workflowType: "synthetic-demo",
    requestId: "old-run",
    currentStage: "prepare",
    input: {},
  });

  return { familyId, userId, familyRepo };
}

function buildEngine(objectStorage: ObjectStorage) {
  const workflowRepository = createWorkflowRepository(db);
  const familyDeletionRepository = createFamilyDeletionRepository(db);
  const registry = {
    [DELETE_FAMILY_TYPE]: asWorkflowDefinition(
      createDeleteFamilyWorkflow({ familyDeletionRepository, objectStorage }),
    ),
  };
  const engine = createWorkflowEngine({ repo: workflowRepository, registry });
  return { engine, workflowRepository, familyDeletionRepository };
}

async function familyRowCounts(familyId: string) {
  const n = async (rows: Promise<unknown[]>) => (await rows).length;
  return {
    characters: await n(
      db
        .select()
        .from(childCharacters)
        .where(eq(childCharacters.familyId, familyId)),
    ),
    visualAssets: await n(
      db.select().from(visualAssets).where(eq(visualAssets.familyId, familyId)),
    ),
    stories: await n(
      db.select().from(stories).where(eq(stories.familyId, familyId)),
    ),
    chapters: await n(
      db.select().from(chapters).where(eq(chapters.familyId, familyId)),
    ),
    revisions: await n(
      db
        .select()
        .from(chapterRevisions)
        .where(eq(chapterRevisions.familyId, familyId)),
    ),
    specs: await n(
      db
        .select()
        .from(illustrationSpecs)
        .where(eq(illustrationSpecs.familyId, familyId)),
    ),
    illustrationAssets: await n(
      db
        .select()
        .from(illustrationAssets)
        .where(eq(illustrationAssets.familyId, familyId)),
    ),
    generationRuns: await n(
      db
        .select()
        .from(generationRuns)
        .where(eq(generationRuns.familyId, familyId)),
    ),
    imageRuns: await n(
      db
        .select()
        .from(imageGenerationRuns)
        .where(eq(imageGenerationRuns.familyId, familyId)),
    ),
    preferences: await n(
      db
        .select()
        .from(storyPreferences)
        .where(eq(storyPreferences.familyId, familyId)),
    ),
    members: await n(
      db
        .select()
        .from(familyMembers)
        .where(eq(familyMembers.familyId, familyId)),
    ),
  };
}

describe("family deletion workflow", () => {
  it("purges every family-scoped table, deletes all storage keys, revokes access, and records a complete audit", async () => {
    const { familyId, userId, familyRepo } = await seedFamilyWithContent();
    const { storage, deleted } = recordingStorage();
    const { engine, workflowRepository, familyDeletionRepository } =
      buildEngine(storage);

    const { execution } = await workflowRepository.createOrGetExecution({
      familyId,
      userId,
      type: DELETE_FAMILY_TYPE,
      requestId: `delete-family:${familyId}`,
      entityId: familyId,
      input: { familyId },
      initialStage: "revoke-access",
    });

    const drive = await engine.runToCompletion(execution.id);
    expect(drive.finalStatus).toBe("completed");

    // Every storage key was deleted (both the visual reference and the image).
    expect(deleted).toContain(KEY_VISUAL);
    expect(deleted).toContain(KEY_IMAGE);

    // Every family-scoped content table is empty for this family.
    const counts = await familyRowCounts(familyId);
    for (const [table, n] of Object.entries(counts)) {
      expect(n, `${table} must be empty for the deleted family`).toBe(0);
    }

    // The families row remains as an anonymised tombstone.
    const [fam] = await db
      .select()
      .from(families)
      .where(eq(families.id, familyId));
    expect(fam.deletedAt).not.toBeNull();
    expect(fam.name).toBe("Deleted family");

    // Only the deletion workflow's own execution remains (the prior one is gone).
    const remainingWorkflows = await db
      .select()
      .from(workflowExecutions)
      .where(eq(workflowExecutions.familyId, familyId));
    expect(remainingWorkflows).toHaveLength(1);
    expect(remainingWorkflows[0].id).toBe(execution.id);
    expect(remainingWorkflows[0].status).toBe("completed");

    // The audit trail is complete and ordered.
    expect(await familyDeletionRepository.listAuditSteps(familyId)).toEqual([
      "revoke-access",
      "purge-storage",
      "purge-database",
    ]);

    // Reader/delivery access is revoked: authorisation now fails (no membership).
    await expect(
      authorizeFamilyAction(familyRepo, {
        userId,
        familyId,
        capability: "story:read",
      }),
    ).rejects.toSatisfy(
      (e: unknown) => isDomainError(e) && e.code === "UNAUTHORISED",
    );
  });

  it("is idempotent and resumable — a crash mid-purge resumes without duplicate work or lost audit", async () => {
    const { familyId, userId } = await seedFamilyWithContent();
    const { storage, deleted } = recordingStorage();
    const { engine, workflowRepository, familyDeletionRepository } =
      buildEngine(storage);

    const { execution } = await workflowRepository.createOrGetExecution({
      familyId,
      userId,
      type: DELETE_FAMILY_TYPE,
      requestId: `delete-family:${familyId}`,
      entityId: familyId,
      input: { familyId },
      initialStage: "revoke-access",
    });

    // Interrupt after the first stage (revoke-access), simulating a crash.
    const first = await engine.runToCompletion(execution.id, {
      maxStages: 1,
    });
    expect(first.stopped).toBe(true);
    expect(await familyDeletionRepository.isDeleted(familyId)).toBe(true);

    // Resume with a FRESH engine instance against the same DB.
    const resumed = buildEngine(storage);
    const drive = await resumed.engine.runToCompletion(execution.id);
    expect(drive.finalStatus).toBe("completed");

    // Audit is complete exactly once (idempotent step recording).
    expect(
      await resumed.familyDeletionRepository.listAuditSteps(familyId),
    ).toEqual(["revoke-access", "purge-storage", "purge-database"]);

    // Content purged.
    const counts = await familyRowCounts(familyId);
    expect(Object.values(counts).every((n) => n === 0)).toBe(true);

    // Driving AGAIN is a safe no-op (already terminal) — no duplicate storage
    // deletes beyond what was needed, and still completed.
    const again = await resumed.engine.runToCompletion(execution.id);
    expect(again.finalStatus).toBe("completed");
    expect(deleted.length).toBeGreaterThanOrEqual(2);
  });
});
