import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFakeImageModel } from "@/adapters/images/fake-image-model";
import { createFilesystemObjectStorage } from "@/adapters/storage/filesystem-object-storage";
import { createCharacterCommands } from "@/application/character-commands";
import type { JobDispatcher } from "@/application/ports/job-dispatcher";
import { createVisualCharacterService } from "@/application/visual-character-service";
import {
  asWorkflowDefinition,
  createWorkflowEngine,
  type WorkflowRegistry,
} from "@/application/workflow-engine";
import { createWorkflowRegistry } from "@/application/workflow-registry";
import { createWorkflowService } from "@/application/workflow-service";
import {
  createSyntheticWorkflowDefinition,
  SYNTHETIC_STAGE_KEYS,
  SYNTHETIC_WORKFLOW_TYPE,
  type SyntheticStageKey,
} from "@/application/workflows/synthetic-workflow";
import { GENERATE_CHARACTER_CANDIDATES_TYPE } from "@/application/workflows/generate-character-candidates-workflow";
import type { AuthenticatedActor } from "@/domain/actor";
import type { CharacterProfilePayload } from "@/domain/character";
import { generationFailedError, invalidCommandError } from "@/lib/errors";
import type { Database } from "./client";
import { createCharacterRepository } from "./repositories/character-repository";
import { createFamilyRepository } from "./repositories/family-repository";
import { createVisualAssetRepository } from "./repositories/visual-asset-repository";
import { createWorkflowRepository } from "./repositories/workflow-repository";
import { users, workflowExecutions } from "./schema";
import { createTestDatabase, type TestDatabase } from "./testing";

/**
 * Milestone 5 exit criterion (`docs/IMPLEMENTATION_PLAN.md`): "a synthetic
 * multi-stage job survives interruption and resumes without duplicate work".
 * Every test runs the REAL engine + Drizzle repository against a migrated-from-
 * empty PGlite — no mocks — so the state machine, idempotency, lease/retry
 * accounting, and durable resume are exercised end to end. No child production
 * data is used (AGENTS.md).
 */

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

async function seedFamily(userId: string, familyName: string): Promise<string> {
  const { family } = await familyRepo.createFamilyWithOwner({
    userId,
    familyName,
  });
  return family.id;
}

function ownerActor(userId: string, familyId: string): AuthenticatedActor {
  return { userId, familyIds: [familyId], roles: ["owner"] };
}

/** A dispatcher that records calls but runs nothing (service-level tests). */
function recordingDispatcher(): JobDispatcher & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async dispatch(workflowId) {
      calls.push(workflowId);
    },
  };
}

/** A near-instant sleep so retry back-off does not slow the suite. */
const instantSleep = async () => {};

beforeEach(async () => {
  harness = await createTestDatabase();
  db = harness.db;
  familyRepo = createFamilyRepository(db);
});

afterEach(async () => {
  await harness.close();
});

describe("resume without duplicate work (M5 exit criterion)", () => {
  it("survives interruption after stage 1 and resumes without re-running it", async () => {
    const user = await seedUser("resume-owner");
    const familyId = await seedFamily(user, "Resumers");
    const repo = createWorkflowRepository(db);

    // Create the run (queued at the first stage).
    const { execution } = await repo.createOrGetExecution({
      familyId,
      userId: user,
      type: SYNTHETIC_WORKFLOW_TYPE,
      requestId: "run-1",
      input: {},
      initialStage: SYNTHETIC_STAGE_KEYS[0],
    });

    // Dispatcher/engine instance A — counts real handler invocations.
    const invocationsA: Partial<Record<SyntheticStageKey, number>> = {};
    const registryA: WorkflowRegistry = {
      [SYNTHETIC_WORKFLOW_TYPE]: asWorkflowDefinition(
        createSyntheticWorkflowDefinition({
          onStage: (key) => {
            invocationsA[key] = (invocationsA[key] ?? 0) + 1;
          },
        }),
      ),
    };
    const engineA = createWorkflowEngine({ repo, registry: registryA });

    // CRASH after exactly one stage: shouldContinue stops once one stage ran.
    const driveA = await engineA.runToCompletion(execution.id, {
      shouldContinue: (completed) => completed < 1,
    });
    expect(driveA.stopped).toBe(true);
    expect(invocationsA).toEqual({ prepare: 1 });

    // The workflow is durably parked mid-flight: stage 1 persisted, advanced.
    const parked = await repo.getExecutionById(execution.id);
    expect(parked?.status).toBe("waiting");
    expect(parked?.currentStage).toBe("assemble");
    expect(await repo.getStageOutput(execution.id, "prepare")).not.toBeNull();
    expect(await repo.getStageOutput(execution.id, "assemble")).toBeNull();

    // FRESH dispatcher/engine instance B (fresh repo, SAME database) resumes.
    const invocationsB: Partial<Record<SyntheticStageKey, number>> = {};
    const repoB = createWorkflowRepository(db);
    const engineB = createWorkflowEngine({
      repo: repoB,
      registry: {
        [SYNTHETIC_WORKFLOW_TYPE]: asWorkflowDefinition(
          createSyntheticWorkflowDefinition({
            onStage: (key) => {
              invocationsB[key] = (invocationsB[key] ?? 0) + 1;
            },
          }),
        ),
      },
    });
    const driveB = await engineB.runToCompletion(execution.id);

    // Completed, with the two remaining stages run exactly once each …
    expect(driveB.finalStatus).toBe("completed");
    expect(invocationsB).toEqual({ assemble: 1, finish: 1 });
    // … and stage 1 was NEVER re-invoked on the resuming engine.
    expect(invocationsB.prepare).toBeUndefined();
    expect(invocationsA).toEqual({ prepare: 1 });

    // All three outputs present exactly once; final status completed.
    const outputs = await repoB.listStageOutputs(execution.id);
    expect(outputs.map((o) => o.stageKey).sort()).toEqual(
      [...SYNTHETIC_STAGE_KEYS].sort(),
    );
    const done = await repoB.getExecutionById(execution.id);
    expect(done?.status).toBe("completed");
    expect(done?.completedAt).toBeInstanceOf(Date);
  });

  it("skips a stage whose output already exists (crash between persist and advance)", async () => {
    const user = await seedUser("skip-owner");
    const familyId = await seedFamily(user, "Skippers");
    const repo = createWorkflowRepository(db);
    const { execution } = await repo.createOrGetExecution({
      familyId,
      userId: user,
      type: SYNTHETIC_WORKFLOW_TYPE,
      requestId: "skip-1",
      input: {},
      initialStage: SYNTHETIC_STAGE_KEYS[0],
    });

    const invocations: Partial<Record<SyntheticStageKey, number>> = {};
    const engine = createWorkflowEngine({
      repo,
      registry: {
        [SYNTHETIC_WORKFLOW_TYPE]: asWorkflowDefinition(
          createSyntheticWorkflowDefinition({
            onStage: (key) => {
              invocations[key] = (invocations[key] ?? 0) + 1;
            },
          }),
        ),
      },
    });

    // Run stage 1 (persists "prepare", advances to "assemble").
    await engine.runToCompletion(execution.id, { maxStages: 1 });
    expect(invocations.prepare).toBe(1);

    // Simulate a crash that persisted the output but not the advance: point the
    // current stage back at "prepare" while its output already exists.
    await db
      .update(workflowExecutions)
      .set({ currentStage: "prepare", status: "waiting", leaseOwner: null })
      .where(eq(workflowExecutions.id, execution.id));

    // Resuming must SKIP "prepare" (no second invocation) and complete cleanly.
    const drive = await engine.runToCompletion(execution.id);
    expect(drive.finalStatus).toBe("completed");
    expect(invocations.prepare).toBe(1); // never re-invoked
  });
});

describe("idempotent creation", () => {
  it("concurrent duplicate starts create exactly ONE execution", async () => {
    const user = await seedUser("dup-owner");
    const familyId = await seedFamily(user, "Deduplicators");
    const actor = ownerActor(user, familyId);
    const repo = createWorkflowRepository(db);
    const dispatcher = recordingDispatcher();
    const service = createWorkflowService({
      familyRepository: familyRepo,
      workflowRepository: repo,
      registry: createWorkflowRegistry({
        visualCharacterService: {} as never,
      }),
      dispatcher,
    });

    const [a, b] = await Promise.all([
      service.startWorkflow(actor, SYNTHETIC_WORKFLOW_TYPE, "same-request", {}),
      service.startWorkflow(actor, SYNTHETIC_WORKFLOW_TYPE, "same-request", {}),
    ]);

    expect(a.workflowId).toBe(b.workflowId);
    // Exactly one of the two submissions actually created the row.
    expect([a.created, b.created].filter(Boolean)).toHaveLength(1);

    const rows = await db
      .select()
      .from(workflowExecutions)
      .where(eq(workflowExecutions.userId, user));
    expect(rows).toHaveLength(1);
    // Only the creating submission dispatched work.
    expect(dispatcher.calls).toEqual([a.workflowId]);
  });
});

describe("retries and dead-lettering", () => {
  it("retries a retryable failure with back-off and then succeeds", async () => {
    const user = await seedUser("retry-owner");
    const familyId = await seedFamily(user, "Retriers");
    const repo = createWorkflowRepository(db);
    const { execution } = await repo.createOrGetExecution({
      familyId,
      userId: user,
      type: SYNTHETIC_WORKFLOW_TYPE,
      requestId: "retry-1",
      input: {},
      initialStage: SYNTHETIC_STAGE_KEYS[0],
    });

    let assembleAttempts = 0;
    const engine = createWorkflowEngine({
      repo,
      registry: {
        [SYNTHETIC_WORKFLOW_TYPE]: asWorkflowDefinition(
          createSyntheticWorkflowDefinition({
            behaviour: {
              assemble: (ctx) => {
                assembleAttempts += 1;
                if (ctx.attempt === 0) {
                  throw generationFailedError({
                    internalDetail: "transient blip",
                  });
                }
                return { output: { recovered: true } };
              },
            },
          }),
        ),
      },
    });

    const drive = await engine.runToCompletion(execution.id, {
      sleep: instantSleep,
    });

    expect(drive.finalStatus).toBe("completed");
    expect(assembleAttempts).toBe(2); // failed once, succeeded on retry
    const outputs = await repo.listStageOutputs(execution.id);
    expect(outputs.map((o) => o.stageKey).sort()).toEqual(
      [...SYNTHETIC_STAGE_KEYS].sort(),
    );
    // Attempt counter reset and the transient error cleared on success.
    const done = await repo.getExecutionById(execution.id);
    expect(done?.attempt).toBe(0);
    expect(done?.lastError).toBeUndefined();
  });

  it("dead-letters a non-retryable failure with resumable state", async () => {
    const user = await seedUser("dead-owner");
    const familyId = await seedFamily(user, "DeadLetters");
    const repo = createWorkflowRepository(db);
    const { execution } = await repo.createOrGetExecution({
      familyId,
      userId: user,
      type: SYNTHETIC_WORKFLOW_TYPE,
      requestId: "dead-1",
      input: {},
      initialStage: SYNTHETIC_STAGE_KEYS[0],
    });

    let assembleAttempts = 0;
    const engine = createWorkflowEngine({
      repo,
      registry: {
        [SYNTHETIC_WORKFLOW_TYPE]: asWorkflowDefinition(
          createSyntheticWorkflowDefinition({
            behaviour: {
              assemble: () => {
                assembleAttempts += 1;
                throw invalidCommandError({
                  safeMessage: "This cannot be made.",
                  internalDetail: "corrupt canonical data",
                });
              },
            },
          }),
        ),
      },
    });

    const drive = await engine.runToCompletion(execution.id, {
      sleep: instantSleep,
    });

    expect(drive.finalStatus).toBe("failed");
    // A non-retryable failure is NOT retried — one attempt only.
    expect(assembleAttempts).toBe(1);

    const dead = await repo.getExecutionById(execution.id);
    expect(dead?.status).toBe("failed");
    // Resumable: the current stage is preserved and stage 1's output is intact.
    expect(dead?.currentStage).toBe("assemble");
    expect(dead?.completedAt).toBeUndefined();
    expect(await repo.getStageOutput(execution.id, "prepare")).not.toBeNull();
    expect(await repo.getStageOutput(execution.id, "assemble")).toBeNull();
    // The stored error is the SAFE shape (no internal detail).
    expect(dead?.lastError?.code).toBe("INVALID_COMMAND");
    expect(JSON.stringify(dead?.lastError)).not.toContain(
      "corrupt canonical data",
    );

    // Re-queue (resume) moves it back to queued, preserving the stage.
    const requeued = await repo.requeue(familyId, execution.id);
    expect(requeued?.status).toBe("queued");
    expect(requeued?.currentStage).toBe("assemble");
  });
});

describe("concurrency guard (lease)", () => {
  it("prevents a second drive from running the same stage while leased", async () => {
    const user = await seedUser("lease-owner");
    const familyId = await seedFamily(user, "Leasers");
    const repo = createWorkflowRepository(db);
    const { execution } = await repo.createOrGetExecution({
      familyId,
      userId: user,
      type: SYNTHETIC_WORKFLOW_TYPE,
      requestId: "lease-1",
      input: {},
      initialStage: SYNTHETIC_STAGE_KEYS[0],
    });

    // Drive A claims the workflow and holds the lease.
    const first = await repo.claim({
      workflowId: execution.id,
      leaseOwner: "drive-A",
      leaseMs: 60_000,
    });
    expect(first).not.toBeNull();

    // Drive B cannot claim while the lease is live.
    const blocked = await repo.claim({
      workflowId: execution.id,
      leaseOwner: "drive-B",
      leaseMs: 60_000,
    });
    expect(blocked).toBeNull();

    // Once the lease has EXPIRED, another drive may reclaim (visibility timeout).
    const reclaimed = await repo.claim({
      workflowId: execution.id,
      leaseOwner: "drive-B",
      leaseMs: 60_000,
      now: new Date(Date.now() + 120_000),
    });
    expect(reclaimed).not.toBeNull();
    expect(reclaimed?.leaseOwner).toBe("drive-B");
  });
});

describe("client-safe status view + family scoping", () => {
  it("returns parent-friendly labels and hides other families' workflows", async () => {
    const userA = await seedUser("status-a");
    const familyA = await seedFamily(userA, "Family A");
    const actorA = ownerActor(userA, familyA);
    const userB = await seedUser("status-b");
    const familyB = await seedFamily(userB, "Family B");
    const actorB = ownerActor(userB, familyB);

    const repo = createWorkflowRepository(db);
    const service = createWorkflowService({
      familyRepository: familyRepo,
      workflowRepository: repo,
      registry: createWorkflowRegistry({ visualCharacterService: {} as never }),
      dispatcher: recordingDispatcher(),
    });

    const handle = await service.startWorkflow(
      actorA,
      SYNTHETIC_WORKFLOW_TYPE,
      "status-req",
      { label: "demo" },
    );

    const view = await service.getWorkflowStatus(actorA, handle.workflowId);
    expect(view).not.toBeNull();
    // Parent-friendly loading copy — never a raw stage key.
    expect(view?.label).toBe("Getting things ready");
    expect(view?.status).toBe("queued");
    expect(view?.isTerminal).toBe(false);
    expect(view?.error).toBeNull();

    // Family B cannot see family A's workflow.
    expect(
      await service.getWorkflowStatus(actorB, handle.workflowId),
    ).toBeNull();
  });
});

describe("real consumer: generate character candidates on the engine", () => {
  it("paints quarantined candidate sets by driving the workflow to completion", async () => {
    const storageRoot = await mkdtemp(path.join(tmpdir(), "storylight-wf-"));
    try {
      const user = await seedUser("paint-owner");
      const familyId = await seedFamily(user, "Painters");
      const actor = ownerActor(user, familyId);

      const characterRepo = createCharacterRepository(db);
      const visualRepo = createVisualAssetRepository(db);
      const workflowRepo = createWorkflowRepository(db);
      const commands = createCharacterCommands({
        familyRepository: familyRepo,
        characterRepository: characterRepo,
      });

      const character = await commands.createCharacterProfile(
        actor,
        payload("Rosa"),
      );

      const visualCharacterService = createVisualCharacterService({
        familyRepository: familyRepo,
        characterRepository: characterRepo,
        visualAssetRepository: visualRepo,
        objectStorage: createFilesystemObjectStorage(storageRoot),
        imageModel: createFakeImageModel(),
      });

      const registry = createWorkflowRegistry({ visualCharacterService });
      const engine = createWorkflowEngine({ repo: workflowRepo, registry });
      const service = createWorkflowService({
        familyRepository: familyRepo,
        workflowRepository: workflowRepo,
        registry,
        dispatcher: recordingDispatcher(),
      });

      const handle = await service.startWorkflow(
        actor,
        GENERATE_CHARACTER_CANDIDATES_TYPE,
        `paint-${character.id}`,
        { characterId: character.id },
      );
      expect(handle.created).toBe(true);

      // Drive the durable workflow to completion (the dispatcher was a no-op).
      const drive = await engine.runToCompletion(handle.workflowId);
      expect(drive.finalStatus).toBe("completed");

      // The character now has quarantined candidate sets awaiting review.
      const pending = await visualCharacterService.listPendingCandidateSets(
        actor,
        character.id,
      );
      expect(pending.length).toBeGreaterThan(0);
      expect(pending[0].assets).toHaveLength(6);

      // Progress is discoverable by entity for the appearance UI.
      const view = await service.getLatestWorkflowForEntity(
        actor,
        GENERATE_CHARACTER_CANDIDATES_TYPE,
        character.id,
      );
      expect(view?.isComplete).toBe(true);
    } finally {
      await rm(storageRoot, { recursive: true, force: true });
    }
  });
});

function payload(displayName: string): CharacterProfilePayload {
  return {
    displayName,
    apparentAge: 7,
    pronouns: ["they", "them"],
    narrativeIdentity: {
      personalityTraits: [],
      strengths: [],
      vulnerabilities: [],
      interests: ["beetles", "maps"],
      values: [],
      speechStyle: {
        sentenceLength: "mixed",
        directness: "reflective",
        humourStyle: [],
        vocabularyNotes: [],
        prohibitedPatterns: [],
      },
      behaviourRules: [],
      forbiddenCharacterisations: [],
    },
    fictionalisationPolicy: {
      mayUseMagic: true,
      mayTransformTemporarily: true,
      mayPortrayMildDisagreement: true,
      mayPortrayFear: true,
      mayUseRealFamilyMembers: false,
      mayInventSchoolOrHomeDetails: false,
      excludedThemes: [],
    },
    visualProfileId: null,
  };
}
