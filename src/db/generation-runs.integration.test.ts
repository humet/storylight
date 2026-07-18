import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFakeLanguageModel } from "@/adapters/ai/fake-language-model";
import type { FakeScript } from "@/adapters/ai/fake-language-model";
import { createStructuredGenerator } from "@/application/ai/generate-structured";
import { DEFAULT_MODEL_ROUTES } from "@/application/model-routes/default-model-routes";
import { createModelRegistry } from "@/application/model-routes/model-registry";
import { createModelPricing } from "@/application/model-routes/pricing";
import { createWorkflowEngine } from "@/application/workflow-engine";
import { createWorkflowRegistry } from "@/application/workflow-registry";
import { createWorkflowService } from "@/application/workflow-service";
import { STRUCTURED_PLAN_DEMO_TYPE } from "@/application/workflows/structured-plan-demo-workflow";
import type { AuthenticatedActor } from "@/domain/actor";
import type { Database } from "./client";
import { createFamilyRepository } from "./repositories/family-repository";
import { createGenerationRunRepository } from "./repositories/generation-run-repository";
import { createModelRouteRepository } from "./repositories/model-route-repository";
import { createWorkflowRepository } from "./repositories/workflow-repository";
import {
  generationArtifacts,
  generationRuns,
  users,
  workflowExecutions,
  workflowStageOutputs,
} from "./schema";
import { createTestDatabase, type TestDatabase } from "./testing";

/**
 * Milestone 6 EXIT CRITERION (`docs/IMPLEMENTATION_PLAN.md`): "test model outputs
 * flow through parse, normalise, domain validate, and persist". The synthetic
 * demo workflow runs on the REAL engine + Drizzle repositories + a FAKE language
 * adapter against a migrated-from-empty PGlite (which includes the seeded routes),
 * so the whole M6 stack — capability routing, the pipeline, generation-run
 * records, and the lineage on stage outputs — is exercised end to end. No child
 * production data is used (AGENTS.md).
 */

const VALID_PLAN = JSON.stringify({
  schemaVersion: "synthetic-plan.v1",
  title: "The Lantern",
  summary: "A gentle tale about a small lantern.",
  characters: [{ key: "rosa", name: "Rosa" }],
  beats: [{ key: "beat-1", characterKey: "rosa", action: "finds a lantern" }],
});

const MISSING_TITLE = JSON.stringify({
  schemaVersion: "synthetic-plan.v1",
  summary: "No title on purpose.",
  characters: [{ key: "rosa", name: "Rosa" }],
  beats: [{ key: "beat-1", characterKey: "rosa", action: "does a thing" }],
});

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

/** Build the full M6 stack over the test DB with a scripted fake language model. */
function buildStack(script: FakeScript) {
  const workflowRepo = createWorkflowRepository(db);
  const generationRunRepository = createGenerationRunRepository(db);
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
  });
  const engine = createWorkflowEngine({ repo: workflowRepo, registry });
  const service = createWorkflowService({
    familyRepository: familyRepo,
    workflowRepository: workflowRepo,
    registry,
    dispatcher: { async dispatch() {} },
  });
  return { workflowRepo, generationRunRepository, engine, service };
}

beforeEach(async () => {
  harness = await createTestDatabase();
  db = harness.db;
  familyRepo = createFamilyRepository(db);
});

afterEach(async () => {
  await harness.close();
});

describe("seeded model routes", () => {
  it("migrates the source-controlled default routes and matches the TS source", async () => {
    const repo = createModelRouteRepository(db);
    for (const expected of DEFAULT_MODEL_ROUTES) {
      const active = await repo.getActiveRoute(expected.capability);
      expect(active, `active route for ${expected.capability}`).not.toBeNull();
      expect(active).toEqual(expected);
    }
  });

  it("enforces at most one ACTIVE route per capability (DB constraint)", async () => {
    // The seed has an active one-off-planning route; inserting a SECOND active
    // one for the same capability must violate the partial unique index.
    await expect(
      db.execute(sql`
        insert into model_route_versions
          (capability, version, primary_target, fallbacks, settings, lifecycle_status)
        values ('one-off-planning', '9.9.9', 'anthropic/claude-sonnet-5', '[]'::jsonb, '{"maxOutputTokens":10}'::jsonb, 'active')
      `),
    ).rejects.toThrow();
  });
});

describe("M6 exit: structured artifact through the full pipeline", () => {
  it("flows parse → normalise → domain validate → persist (runs + artifact + lineage)", async () => {
    const user = await seedUser("m6-owner");
    const familyId = await seedFamily(user, "Planners");
    const actor = ownerActor(user, familyId);
    const { engine, service, generationRunRepository } = buildStack({
      kind: "text",
      text: VALID_PLAN,
    });

    const handle = await service.startWorkflow(
      actor,
      STRUCTURED_PLAN_DEMO_TYPE,
      "plan-1",
      { idea: "a lantern in the garden" },
    );
    const drive = await engine.runToCompletion(handle.workflowId);
    expect(drive.finalStatus).toBe("completed");

    // generation_runs: exactly one accepted run for this workflow.
    const runs = await generationRunRepository.listRunsForWorkflow(
      handle.workflowId,
    );
    expect(runs).toHaveLength(1);
    expect(runs[0].outcome).toBe("accepted");
    expect(runs[0].capability).toBe("one-off-planning");
    expect(runs[0].resolvedModelId).toContain("anthropic/claude-sonnet-5");
    expect(runs[0].promptVersion).toBe("1.0.0");
    expect(runs[0].schemaVersion).toBe("synthetic-plan.v1");
    expect(runs[0].totalTokens).toBeGreaterThan(0);
    // The run links to the validated artifact.
    expect(runs[0].artifactRef).not.toBeNull();

    // generation_artifacts: the validated, id-mapped plan (never raw output).
    const artifact = await generationRunRepository.getArtifact(
      handle.workflowId,
      "plan",
    );
    expect(artifact).not.toBeNull();
    const payload = artifact!.payload as {
      title: string;
      beatCount: number;
      characters: { id: string; key: string }[];
      beats: { id: string; characterId: string }[];
    };
    expect(payload.title).toBe("The Lantern");
    expect(payload.beatCount).toBe(1);
    // Keys were mapped to app-generated ids; the beat resolves to the character.
    expect(payload.characters[0].id).not.toBe(payload.characters[0].key);
    expect(payload.beats[0].characterId).toBe(payload.characters[0].id);

    // The stage output carries the generation lineage (orchestration.md).
    const [stageOutput] = await db
      .select()
      .from(workflowStageOutputs)
      .where(eq(workflowStageOutputs.workflowId, handle.workflowId));
    expect(stageOutput.promptVersion).toBe("1.0.0");
    expect(stageOutput.schemaVersion).toBe("synthetic-plan.v1");
    expect(stageOutput.modelRouteVersion).toBe(
      "b5cefd48-c5c8-5d0f-a81c-c357a9f1dd32",
    );
    expect(stageOutput.usage).not.toBeNull();
  });

  it("records a repair chain when the first output is invalid, then completes", async () => {
    const user = await seedUser("m6-repair");
    const familyId = await seedFamily(user, "Repairers");
    const actor = ownerActor(user, familyId);
    const { engine, service, generationRunRepository } = buildStack([
      { kind: "text", text: MISSING_TITLE },
      { kind: "text", text: VALID_PLAN },
    ]);

    const handle = await service.startWorkflow(
      actor,
      STRUCTURED_PLAN_DEMO_TYPE,
      "plan-repair",
      { idea: "a lantern" },
    );
    const drive = await engine.runToCompletion(handle.workflowId);
    expect(drive.finalStatus).toBe("completed");

    const runs = await generationRunRepository.listRunsForWorkflow(
      handle.workflowId,
    );
    expect(runs.map((r) => r.outcome)).toEqual(["rejected", "repaired"]);
    expect(runs[0].failureKind).toBe("schema-violation");
    expect(runs[1].parentAttemptIndex).toBe(0);
  });

  it("dead-letters SAFELY when the budget is exhausted (no artifact)", async () => {
    const user = await seedUser("m6-budget");
    const familyId = await seedFamily(user, "Budgeters");
    const actor = ownerActor(user, familyId);
    // Always invalid → the ladder spins to the demo's 4-call budget, then stops.
    const { engine, service, generationRunRepository, workflowRepo } =
      buildStack({ kind: "text", text: MISSING_TITLE });

    const handle = await service.startWorkflow(
      actor,
      STRUCTURED_PLAN_DEMO_TYPE,
      "plan-budget",
      { idea: "a lantern" },
    );
    const drive = await engine.runToCompletion(handle.workflowId, {
      sleep: async () => {},
    });
    expect(drive.finalStatus).toBe("failed");

    const dead = await workflowRepo.getExecutionById(handle.workflowId);
    expect(dead?.status).toBe("failed");
    expect(dead?.lastError?.code).toBe("GENERATION_FAILED");

    const runs = await generationRunRepository.listRunsForWorkflow(
      handle.workflowId,
    );
    // Four rejected model calls plus the terminal budget-exceeded row.
    expect(runs.filter((r) => r.outcome === "rejected")).toHaveLength(4);
    const budgetRow = runs.find((r) => r.failureKind === "budget-exceeded");
    expect(budgetRow?.outcome).toBe("failed");
    // No artifact persisted on failure.
    expect(
      await generationRunRepository.getArtifact(handle.workflowId, "plan"),
    ).toBeNull();
  });

  it("re-records idempotently after a lost stage output (no duplicate rows)", async () => {
    const user = await seedUser("m6-idem");
    const familyId = await seedFamily(user, "Idempotent");
    const actor = ownerActor(user, familyId);

    const first = buildStack({ kind: "text", text: VALID_PLAN });
    const handle = await first.service.startWorkflow(
      actor,
      STRUCTURED_PLAN_DEMO_TYPE,
      "plan-idem",
      { idea: "a lantern" },
    );
    await first.engine.runToCompletion(handle.workflowId);

    const firstArtifact = await first.generationRunRepository.getArtifact(
      handle.workflowId,
      "plan",
    );

    // Simulate a crash: the side effects committed but the stage output was lost.
    await db
      .delete(workflowStageOutputs)
      .where(eq(workflowStageOutputs.workflowId, handle.workflowId));
    await db
      .update(workflowExecutions)
      .set({
        status: "waiting",
        currentStage: "plan",
        leaseOwner: null,
        leaseExpiresAt: null,
        completedAt: null,
      })
      .where(eq(workflowExecutions.id, handle.workflowId));

    // Re-drive with a fresh stack (fresh fake) — same deterministic ids.
    const second = buildStack({ kind: "text", text: VALID_PLAN });
    const redrive = await second.engine.runToCompletion(handle.workflowId);
    expect(redrive.finalStatus).toBe("completed");

    // Still exactly one artifact and one run row — re-record collapsed on conflict.
    const artifactRows = await db
      .select()
      .from(generationArtifacts)
      .where(eq(generationArtifacts.workflowId, handle.workflowId));
    expect(artifactRows).toHaveLength(1);
    expect(artifactRows[0].id).toBe(firstArtifact!.id);

    const runRows = await db
      .select()
      .from(generationRuns)
      .where(eq(generationRuns.workflowId, handle.workflowId));
    expect(runRows).toHaveLength(1);
  });
});
