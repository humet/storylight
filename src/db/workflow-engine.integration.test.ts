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
import type {
  GeneratedImage,
  ImageGenerationSpec,
  ImageModel,
} from "@/application/ports/image-model";
import {
  ANCHOR_REFERENCE_VIEW,
  REFERENCE_VIEWS,
  type ReferenceView,
} from "@/domain/reference-view";
import type { AuthenticatedActor } from "@/domain/actor";
import type { CharacterProfilePayload } from "@/domain/character";
import { generationFailedError, invalidCommandError } from "@/lib/errors";
import type { Database } from "./client";
import { createCharacterRepository } from "./repositories/character-repository";
import { createFamilyRepository } from "./repositories/family-repository";
import { createVisualAssetRepository } from "./repositories/visual-asset-repository";
import { createWorkflowRepository } from "./repositories/workflow-repository";
import { users, workflowExecutions, workflowStageOutputs } from "./schema";
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
        structuredGenerator: {} as never,
        generationRunRepository: {} as never,
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

describe("M10 closed debt — durable back-off + matrix-derived cancel/requeue", () => {
  it("does NOT claim a parked-for-retry row before next_attempt_at (durable gate)", async () => {
    const user = await seedUser("backoff-owner");
    const familyId = await seedFamily(user, "Backoff");
    const repo = createWorkflowRepository(db);
    const { execution } = await repo.createOrGetExecution({
      familyId,
      userId: user,
      type: SYNTHETIC_WORKFLOW_TYPE,
      requestId: "backoff-1",
      input: {},
      initialStage: SYNTHETIC_STAGE_KEYS[0],
    });

    // A drive claims (takes the lease) then parks the row for retry with a
    // back-off 30s in the future (as the engine's recordRetry does).
    const base = new Date("2026-07-18T00:00:00.000Z");
    const nextAttemptAt = new Date(base.getTime() + 30_000);
    await repo.claim({
      workflowId: execution.id,
      leaseOwner: "drive-A",
      leaseMs: 60_000,
      now: base,
    });
    await repo.recordRetry({
      workflowId: execution.id,
      leaseOwner: "drive-A",
      attempt: 1,
      error: {
        code: "GENERATION_FAILED",
        message: "transient",
        retryable: true,
        occurredAt: base.toISOString(),
      },
      nextStatus: "waiting",
      nextAttemptAt,
      now: base,
    });

    // A DIFFERENT dispatcher tries to claim BEFORE the back-off elapses — blocked
    // at the DB level (this is the fix: previously it could re-drive immediately).
    const early = await repo.claim({
      workflowId: execution.id,
      leaseOwner: "other-dispatcher",
      leaseMs: 60_000,
      now: new Date(base.getTime() + 10_000),
    });
    expect(early).toBeNull();

    // Once next_attempt_at is due, the claim succeeds.
    const due = await repo.claim({
      workflowId: execution.id,
      leaseOwner: "other-dispatcher",
      leaseMs: 60_000,
      now: nextAttemptAt,
    });
    expect(due).not.toBeNull();
    expect(due?.leaseOwner).toBe("other-dispatcher");
  });

  it("cancel works from a RUNNING (leased) row per the matrix, and a live drive cannot then advance", async () => {
    const user = await seedUser("cancel-owner");
    const familyId = await seedFamily(user, "Cancellers");
    const repo = createWorkflowRepository(db);
    const { execution } = await repo.createOrGetExecution({
      familyId,
      userId: user,
      type: SYNTHETIC_WORKFLOW_TYPE,
      requestId: "cancel-1",
      input: {},
      initialStage: SYNTHETIC_STAGE_KEYS[0],
    });

    // A drive claims → running + live lease.
    const claimed = await repo.claim({
      workflowId: execution.id,
      leaseOwner: "drive-A",
      leaseMs: 60_000,
    });
    expect(claimed?.status).toBe("running");

    // Cancel now legally applies from `running` (the matrix has running--cancel-->
    // cancelled; the old SQL guard wrongly excluded it).
    const cancelled = await repo.cancel(familyId, execution.id);
    expect(cancelled?.status).toBe("cancelled");
    expect(cancelled?.leaseOwner).toBeUndefined();

    // The in-flight drive's advance is a no-op (its lease was cleared) — no
    // resurrection of a cancelled workflow.
    await repo.advanceStage({
      workflowId: execution.id,
      leaseOwner: "drive-A",
      nextStage: SYNTHETIC_STAGE_KEYS[1],
      nextStatus: "waiting",
    });
    const after = await repo.getExecutionById(execution.id);
    expect(after?.status).toBe("cancelled");
  });

  it("requeue only resumes a failed row and cross-family reads are rejected", async () => {
    const user = await seedUser("requeue-owner");
    const familyId = await seedFamily(user, "Requeuers");
    const otherUser = await seedUser("requeue-intruder");
    const otherFamily = await seedFamily(otherUser, "Others");
    const repo = createWorkflowRepository(db);
    const { execution } = await repo.createOrGetExecution({
      familyId,
      userId: user,
      type: SYNTHETIC_WORKFLOW_TYPE,
      requestId: "requeue-1",
      input: {},
      initialStage: SYNTHETIC_STAGE_KEYS[0],
    });

    // A queued (not failed) row cannot be requeued (no `resume` edge from queued).
    expect(await repo.requeue(familyId, execution.id)).toBeNull();

    // Move it to failed, then requeue succeeds — but never cross-family.
    await db
      .update(workflowExecutions)
      .set({ status: "failed" })
      .where(eq(workflowExecutions.id, execution.id));
    expect(await repo.requeue(otherFamily, execution.id)).toBeNull();
    const requeued = await repo.requeue(familyId, execution.id);
    expect(requeued?.status).toBe("queued");
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

describe("lease ownership under the WDK per-drive token (Finding 1)", () => {
  it("a stale drive cannot advance after a NEW token reclaims the expired lease", async () => {
    const user = await seedUser("stale-owner");
    const familyId = await seedFamily(user, "Stale");
    const repo = createWorkflowRepository(db);
    const { execution } = await repo.createOrGetExecution({
      familyId,
      userId: user,
      type: SYNTHETIC_WORKFLOW_TYPE,
      requestId: "stale-1",
      input: {},
      initialStage: SYNTHETIC_STAGE_KEYS[0],
    });

    // Two DISTINCT WDK-format tokens for the SAME workflow (the fix: a unique
    // uuid per drive attempt instead of a constant `wdk:${id}`).
    const tokenA = `wdk:${execution.id}:${crypto.randomUUID()}`;
    const tokenB = `wdk:${execution.id}:${crypto.randomUUID()}`;
    expect(tokenA).not.toBe(tokenB);

    // Drive A claims and holds the lease.
    const claimedA = await repo.claim({
      workflowId: execution.id,
      leaseOwner: tokenA,
      leaseMs: 60_000,
    });
    expect(claimedA).not.toBeNull();

    // Drive B reclaims after A's lease expires (A "crashed").
    const claimedB = await repo.claim({
      workflowId: execution.id,
      leaseOwner: tokenB,
      leaseMs: 60_000,
      now: new Date(Date.now() + 120_000),
    });
    expect(claimedB?.leaseOwner).toBe(tokenB);

    // The STALE drive A now tries to commit its advance. With a per-drive token
    // its guarded write matches nothing — it must NOT steal the lease or advance.
    // (Under the old constant token, A's token == B's token, so this DID commit.)
    await repo.completeStage({
      workflowId: execution.id,
      leaseOwner: tokenA,
      stageKey: SYNTHETIC_STAGE_KEYS[0],
      output: { byStaleDrive: true },
      attempt: 0,
      nextStage: SYNTHETIC_STAGE_KEYS[1],
      nextStatus: "waiting",
    });

    const after = await repo.getExecutionById(execution.id);
    expect(after?.leaseOwner).toBe(tokenB); // still B's lease
    expect(after?.currentStage).toBe(SYNTHETIC_STAGE_KEYS[0]); // NOT advanced by A
    expect(after?.status).toBe("running"); // still B's active claim
  });
});

describe("locked drive retries rather than exits (Finding 1)", () => {
  function syntheticRegistry(): WorkflowRegistry {
    return {
      [SYNTHETIC_WORKFLOW_TYPE]: asWorkflowDefinition(
        createSyntheticWorkflowDefinition(),
      ),
    };
  }

  it("waits for an expiring lease and reclaims instead of abandoning the run", async () => {
    const user = await seedUser("wait-owner");
    const familyId = await seedFamily(user, "Waiters");
    const repo = createWorkflowRepository(db);
    const { execution } = await repo.createOrGetExecution({
      familyId,
      userId: user,
      type: SYNTHETIC_WORKFLOW_TYPE,
      requestId: "wait-1",
      input: {},
      initialStage: SYNTHETIC_STAGE_KEYS[0],
    });

    const base = Date.now();
    // A live lease held by a (crashed) holder — expires at base + 60s.
    const held = await repo.claim({
      workflowId: execution.id,
      leaseOwner: "holder",
      leaseMs: 60_000,
      now: new Date(base),
    });
    expect(held).not.toBeNull();

    let clockMs = base + 1_000; // holder lease still live on the first attempt
    const engine = createWorkflowEngine({
      repo,
      registry: syntheticRegistry(),
      now: () => new Date(clockMs),
    });
    // Each locked wait advances the clock past the lease so the retry reclaims.
    const advancingSleep = async () => {
      clockMs += 120_000;
    };

    const drive = await engine.runToCompletion(execution.id, {
      onLocked: "wait",
      sleep: advancingSleep,
      lockedBackoffMs: 60_000,
    });
    // It did NOT exit at the first locked claim — it waited, reclaimed, finished.
    expect(drive.finalStatus).toBe("completed");
  });

  it("default onLocked STOPS (the in-process holder is a live sibling)", async () => {
    const user = await seedUser("stop-owner");
    const familyId = await seedFamily(user, "Stoppers");
    const repo = createWorkflowRepository(db);
    const { execution } = await repo.createOrGetExecution({
      familyId,
      userId: user,
      type: SYNTHETIC_WORKFLOW_TYPE,
      requestId: "stop-1",
      input: {},
      initialStage: SYNTHETIC_STAGE_KEYS[0],
    });

    await repo.claim({
      workflowId: execution.id,
      leaseOwner: "holder",
      leaseMs: 60_000,
    });

    const engine = createWorkflowEngine({
      repo,
      registry: syntheticRegistry(),
    });
    const drive = await engine.runToCompletion(execution.id, {
      sleep: instantSleep,
    });
    expect(drive.stopped).toBe(true);
    expect(drive.finalStatus).toBe("running");
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
      registry: createWorkflowRegistry({
        visualCharacterService: {} as never,
        structuredGenerator: {} as never,
        generationRunRepository: {} as never,
      }),
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

      const registry = createWorkflowRegistry({
        visualCharacterService,
        structuredGenerator: {} as never,
        generationRunRepository: {} as never,
      });
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

  it("re-running the stage after a lost output does NOT duplicate the set (Finding 2 idempotency)", async () => {
    const storageRoot = await mkdtemp(path.join(tmpdir(), "storylight-wf-"));
    try {
      const user = await seedUser("idem-owner");
      const familyId = await seedFamily(user, "Idempotent");
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
      const registry = createWorkflowRegistry({
        visualCharacterService,
        structuredGenerator: {} as never,
        generationRunRepository: {} as never,
      });
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
        `idem-${character.id}`,
        { characterId: character.id },
      );
      await engine.runToCompletion(handle.workflowId);

      const afterFirst = await visualCharacterService.listPendingCandidateSets(
        actor,
        character.id,
      );
      expect(afterFirst).toHaveLength(1);
      // One set of all six canonical views (one image call per view stage).
      expect(afterFirst[0].assets).toHaveLength(REFERENCE_VIEWS.length);

      // Simulate a crash whose SIDE EFFECTS (uploaded views + the recorded set)
      // committed but whose stage-output writes were all lost: drop every output
      // and reset the run to the FIRST per-view stage so every paint stage AND the
      // assembly stage are forced to execute a second time.
      await db
        .delete(workflowStageOutputs)
        .where(eq(workflowStageOutputs.workflowId, handle.workflowId));
      await db
        .update(workflowExecutions)
        .set({
          status: "waiting",
          // Reset to the FIRST stage — the anchor view — so every paint stage
          // (anchor first, then the conditioned views) and the assembly stage
          // re-run in order on the re-drive.
          currentStage: `paint-${ANCHOR_REFERENCE_VIEW}`,
          leaseOwner: null,
          leaseExpiresAt: null,
          completedAt: null,
        })
        .where(eq(workflowExecutions.id, handle.workflowId));

      // Re-drive: every per-view stage re-runs with the SAME deterministic asset
      // ids/keys/bytes and the assembly re-derives the SAME candidate-set id.
      const redrive = await engine.runToCompletion(handle.workflowId);
      expect(redrive.finalStatus).toBe("completed");

      // Still exactly ONE candidate set — the re-run reproduced it, not a duplicate.
      const afterSecond = await visualCharacterService.listPendingCandidateSets(
        actor,
        character.id,
      );
      expect(afterSecond).toHaveLength(1);
      expect(afterSecond[0].id).toBe(afterFirst[0].id);
      expect(afterSecond[0].assets).toHaveLength(REFERENCE_VIEWS.length);
    } finally {
      await rm(storageRoot, { recursive: true, force: true });
    }
  });

  it("paints the anchor view FIRST and conditions every other view on it (coherent set)", async () => {
    const storageRoot = await mkdtemp(path.join(tmpdir(), "storylight-wf-"));
    try {
      const user = await seedUser("coherent-owner");
      const familyId = await seedFamily(user, "Coherent");
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

      // A SPY image model that records, in call order, which view was generated
      // and whether it was conditioned on an anchor — delegating byte production
      // to the deterministic fake so the pipeline stays offline and unchanged.
      const fake = createFakeImageModel();
      const calls: Array<{ view: ReferenceView; hasAnchor: boolean }> = [];
      const spy: ImageModel = {
        async generate(spec: ImageGenerationSpec): Promise<GeneratedImage> {
          calls.push({
            view: spec.view,
            hasAnchor: Boolean(spec.anchorImage),
          });
          return fake.generate(spec);
        },
      };

      const visualCharacterService = createVisualCharacterService({
        familyRepository: familyRepo,
        characterRepository: characterRepo,
        visualAssetRepository: visualRepo,
        objectStorage: createFilesystemObjectStorage(storageRoot),
        imageModel: spy,
      });
      const registry = createWorkflowRegistry({
        visualCharacterService,
        structuredGenerator: {} as never,
        generationRunRepository: {} as never,
      });
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
        `coherent-${character.id}`,
        { characterId: character.id },
      );
      const drive = await engine.runToCompletion(handle.workflowId);
      expect(drive.finalStatus).toBe("completed");

      // One image call per view.
      expect(calls).toHaveLength(REFERENCE_VIEWS.length);
      // The ANCHOR view is generated FIRST, with NO anchor conditioning.
      expect(calls[0].view).toBe(ANCHOR_REFERENCE_VIEW);
      expect(calls[0].hasAnchor).toBe(false);
      // Every subsequent view is a DIFFERENT view, each conditioned on the anchor.
      const rest = calls.slice(1);
      expect(rest.map((c) => c.view).sort()).toEqual(
        REFERENCE_VIEWS.filter((v) => v !== ANCHOR_REFERENCE_VIEW).sort(),
      );
      expect(rest.every((c) => c.hasAnchor)).toBe(true);
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
    appearanceNotes: null,
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
