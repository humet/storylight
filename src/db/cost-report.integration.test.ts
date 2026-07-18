import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Database } from "./client";
import { createCostRepository } from "./repositories/cost-repository";
import { createFamilyRepository } from "./repositories/family-repository";
import {
  generationRuns,
  imageGenerationRuns,
  stories,
  users,
  workflowExecutions,
} from "./schema";
import { createTestDatabase, type TestDatabase } from "./testing";

/**
 * M10 cost-report proof (`docs/06-engineering/cost-management.md` acceptance: "A
 * cheap but failure-prone model cannot appear artificially inexpensive"). The
 * report sums EVERY attempt — a cheap accepted result plus its costly rejected
 * retries — so the total reflects true accepted-result cost, not the headline
 * accepted-attempt price.
 */

let harness: TestDatabase;
let db: Database;

beforeEach(async () => {
  harness = await createTestDatabase();
  db = harness.db;
});
afterEach(async () => {
  await harness.close();
});

describe("cost report", () => {
  it("counts retries/repair/escalation so a cheap-but-failing route is not artificially cheap", async () => {
    const userId = "cost-owner";
    await db.insert(users).values({
      id: userId,
      name: "Owner",
      email: "cost@example.test",
      emailVerified: true,
    });
    const familyRepo = createFamilyRepository(db);
    const { family } = await familyRepo.createFamilyWithOwner({
      userId,
      familyName: "Costs",
    });
    const familyId = family.id;

    const [story] = await db
      .insert(stories)
      .values({ familyId, userId })
      .returning();

    // The story's text workflow (entity_id = storyId, as all story workflows set).
    const [wf] = await db
      .insert(workflowExecutions)
      .values({
        familyId,
        userId,
        workflowType: "create-one-off-story",
        requestId: "r",
        entityId: story.id,
        currentStage: "plan",
        input: {},
      })
      .returning();

    const run = (
      attemptIndex: number,
      outcome: "accepted" | "rejected",
      cost: number,
    ) => ({
      familyId,
      workflowId: wf.id,
      stageKey: "plan",
      capability: "one-off-planning" as const,
      routeVersion: "1.0.0",
      resolvedModelId: "m",
      target: "t",
      promptVersion: "p",
      schemaVersion: "s",
      attemptIndex,
      phase: "initial" as const,
      outcome,
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
      estimatedCostMinorUnits: cost,
      latencyMs: 5,
    });

    // A "cheap but failing" route: the accepted attempt is cheap (10) but it took
    // THREE costly rejected attempts (50 each) to get there.
    await db
      .insert(generationRuns)
      .values([
        run(0, "rejected", 50),
        run(1, "rejected", 50),
        run(2, "rejected", 50),
        run(3, "accepted", 10),
      ]);

    // Image: an initial (350) that was repaired (350) then escalated (900).
    const imageRun = (phase: string, cost: number) => ({
      familyId,
      storyId: story.id,
      workflowId: wf.id,
      stageKey: "paint",
      capability: "routine-chapter-illustration" as const,
      phase,
      kind: "generation",
      target: "t",
      resolvedModelId: "m",
      routeVersion: "v",
      outcome: phase,
      imageCount: 1,
      estimatedCostMinorUnits: cost,
      latencyMs: 10,
    });
    await db
      .insert(imageGenerationRuns)
      .values([
        imageRun("initial", 350),
        imageRun("repair", 350),
        imageRun("escalation", 900),
      ]);

    const cost = createCostRepository(db);
    const report = await cost.storyCost(familyId, story.id);

    // Text = 3×50 rejected + 10 accepted = 160 (NOT the 10 headline price).
    expect(report.textCostMinorUnits).toBe(160);
    expect(report.textByOutcome.accepted).toBe(10);
    expect(report.textByOutcome.rejected).toBe(150);
    expect(report.textAttempts).toBe(4);

    // Image = 350 + 350 + 900 = 1600.
    expect(report.imageCostMinorUnits).toBe(1600);
    expect(report.imageByPhase.escalation).toBe(900);

    // Total accepted-result cost includes ALL of it.
    expect(report.totalMinorUnits).toBe(1760);

    // The retry portion is the majority — a naive "accepted only" view (10) would
    // hide 150 of text + 1250 of image repair/escalation.
    expect(report.retryCostMinorUnits).toBe(150 + 350 + 900);
    expect(report.retryCostMinorUnits).toBeGreaterThan(
      report.textByOutcome.accepted,
    );
  });
});
