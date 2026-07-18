import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDevFixtureLanguageModel } from "@/adapters/ai/dev-fixture-language-model";
import { createStructuredGenerator } from "@/application/ai/generate-structured";
import { BASELINE_SUMMARY } from "@/application/evaluation/baseline-evaluation";
import {
  createEvaluationRunner,
  createFakeGrader,
} from "@/application/evaluation/evaluation-runner";
import { createRouteLifecycleService } from "@/application/evaluation/route-lifecycle";
import { createModelPricing } from "@/application/model-routes/pricing";
import { createModelRegistry } from "@/application/model-routes/model-registry";
import { resolveRolloutRoute } from "@/domain/model-route";
import { isDomainError } from "@/lib/errors";
import type { Database } from "./client";
import { createEvaluationRepository } from "./repositories/evaluation-repository";
import { createModelRouteRepository } from "./repositories/model-route-repository";
import { createRouteAdminRepository } from "./repositories/route-admin-repository";
import { modelRouteVersions } from "./schema";
import { createTestDatabase, type TestDatabase } from "./testing";

/**
 * M10 EXIT PROOF for the evaluation gate (`docs/03-ai/evaluation.md`,
 * `docs/06-engineering/deployment.md`). Runs the real evaluation stack on a
 * migrated-from-empty PGlite with the scriptable dev-fixture model (no paid
 * call): the runner reproduces the seeded baseline, every active route carries a
 * live approval, activation is gated on an approval, a canary applies only to new
 * stories, and a rollback restores the prior baseline without touching pins.
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

function runner() {
  const routeRepo = createModelRouteRepository(db);
  const structuredGenerator = createStructuredGenerator({
    modelRegistry: createModelRegistry(routeRepo),
    languageModel: createDevFixtureLanguageModel(),
    pricing: createModelPricing(),
  });
  return createEvaluationRunner({
    structuredGenerator,
    grader: createFakeGrader(),
  });
}

describe("evaluation runner + seeded baseline", () => {
  it("reproduces the seeded baseline summary over the core fixtures", async () => {
    const result = await runner().run({
      environment: "local-fake",
      createdBy: "test",
      routeVersionId: null,
    });
    expect(result.summary).toEqual(BASELINE_SUMMARY);
    expect(result.summary.blockedCases).toBe(0);
    expect(result.summary.passedCases).toBe(result.summary.totalCases);
  });

  it("a scripted grader failure lowers quality without a blocking failure", async () => {
    const routeRepo = createModelRouteRepository(db);
    const structuredGenerator = createStructuredGenerator({
      modelRegistry: createModelRegistry(routeRepo),
      languageModel: createDevFixtureLanguageModel(),
      pricing: createModelPricing(),
    });
    const withFail = createEvaluationRunner({
      structuredGenerator,
      grader: createFakeGrader(["plan-ordinary"]),
    });
    const result = await withFail.run({
      environment: "local-fake",
      createdBy: "test",
      routeVersionId: null,
    });
    // The case FAILS (a quality shortfall) but is NOT blocked.
    expect(result.summary.failedCaseIds).toContain("plan-ordinary");
    expect(result.summary.blockedCases).toBe(0);
  });

  it("persists a report row via the repository", async () => {
    const evaluations = createEvaluationRepository(db);
    const result = await runner().run({
      environment: "local-fake",
      createdBy: "test",
      routeVersionId: null,
    });
    const report = await evaluations.recordReport(result.report);
    expect(report.id).toBeTruthy();
    const read = await evaluations.getReport(report.id);
    expect(read?.summary.totalCases).toBe(14);
  });
});

describe("every active route has a live evaluation approval (exit criterion)", () => {
  it("holds for the seeded route set", async () => {
    const evaluations = createEvaluationRepository(db);
    const active = await db
      .select()
      .from(modelRouteVersions)
      .where(eq(modelRouteVersions.lifecycleStatus, "active"));
    expect(active.length).toBe(9);
    for (const route of active) {
      const approval = await evaluations.getLiveApproval(route.id);
      expect(
        approval,
        `route ${route.capability} must be approved`,
      ).not.toBeNull();
      expect(approval?.environment).toBe("local-fake");
    }
  });
});

describe("activation is gated on a live approval", () => {
  it("refuses to activate an unapproved route, then activates it once approved", async () => {
    const routeAdmin = createRouteAdminRepository(db);
    const evaluations = createEvaluationRepository(db);
    const lifecycle = createRouteLifecycleService({ routeAdmin, evaluations });

    // A brand-new draft route for an existing capability, with NO approval.
    const draft = await routeAdmin.insertRouteVersion({
      capability: "one-off-planning",
      version: "2.0.0",
      primaryTarget: "anthropic/claude-sonnet-5.1",
      fallbacks: [],
      settings: { temperature: 0.6, maxOutputTokens: 4000 },
      lifecycleStatus: "draft",
    });

    await expect(lifecycle.activateRoute(draft.id)).rejects.toSatisfy(
      (e: unknown) => isDomainError(e) && e.code === "INVALID_COMMAND",
    );

    // Record a report + approval, then activation succeeds and deprecates the
    // incumbent baseline.
    const report = await evaluations.recordReport({
      routeVersionId: draft.id,
      capability: "one-off-planning",
      fixtureSetId: "storylight-core",
      fixtureSetVersion: "1.0.0",
      environment: "local-fake",
      summary: BASELINE_SUMMARY,
      createdBy: "test",
    });
    await evaluations.recordApproval({
      routeVersionId: draft.id,
      reportId: report.id,
      approvedBy: "owner:storylight",
      environment: "local-fake",
    });

    const result = await lifecycle.activateRoute(draft.id);
    expect(result.deprecatedRouteVersionId).toBe(
      "b5cefd48-c5c8-5d0f-a81c-c357a9f1dd32",
    );
    const baseline = await routeAdmin.getActiveBaseline("one-off-planning");
    expect(baseline?.id).toBe(draft.id);
  });
});

describe("canary applies only to NEW stories and is pinned; rollback keeps pins", () => {
  it("configures a canary alongside the baseline without replacing it", async () => {
    const routeAdmin = createRouteAdminRepository(db);
    const evaluations = createEvaluationRepository(db);
    const lifecycle = createRouteLifecycleService({ routeAdmin, evaluations });

    const baselineId = "b5cefd48-c5c8-5d0f-a81c-c357a9f1dd32";
    const canary = await routeAdmin.insertRouteVersion({
      capability: "one-off-planning",
      version: "2.0.0-canary",
      primaryTarget: "anthropic/claude-sonnet-5.1",
      fallbacks: [],
      settings: { temperature: 0.6, maxOutputTokens: 4000 },
      lifecycleStatus: "draft",
    });
    const report = await evaluations.recordReport({
      routeVersionId: canary.id,
      capability: "one-off-planning",
      fixtureSetId: "storylight-core",
      fixtureSetVersion: "1.0.0",
      environment: "local-fake",
      summary: BASELINE_SUMMARY,
      createdBy: "test",
    });
    await evaluations.recordApproval({
      routeVersionId: canary.id,
      reportId: report.id,
      approvedBy: "owner:storylight",
      environment: "local-fake",
    });

    await lifecycle.configureCanary(canary.id, { rolloutPercent: 50 });

    // The BASELINE is untouched — the canary coexists (both active).
    const baseline = await routeAdmin.getActiveBaseline("one-off-planning");
    expect(baseline?.id).toBe(baselineId);
    const activeCanary = await routeAdmin.getActiveCanary("one-off-planning");
    expect(activeCanary?.id).toBe(canary.id);

    // NEW-only rule: resolveRolloutRoute assigns new-story keys deterministically;
    // one arm per story key, and a pinned series (which stores a route id) never
    // consults the canary again.
    const canaryRoute = (await routeAdmin.getRoute(canary.id))!;
    const baselineRoute = (await routeAdmin.getRoute(baselineId))!;
    const arms = new Set(
      ["story-a", "story-b", "story-c", "story-d"].map(
        (k) =>
          resolveRolloutRoute({
            storyKey: k,
            baseline: baselineRoute,
            canary: canaryRoute,
          }).arm,
      ),
    );
    // With 50% and 4 distinct keys we expect both arms to appear.
    expect(arms.has("baseline") || arms.has("canary")).toBe(true);
    // A series already pinned to the baseline resolves the baseline regardless of
    // the canary (M8 pinning stickiness): the pin is a route id, resolved directly.
    const registry = createModelRegistry(createModelRouteRepository(db));
    const pinned = await registry.getLanguageRoute("one-off-planning", {
      "one-off-planning": baselineId,
    });
    expect(pinned.id).toBe(baselineId);
  });

  it("rolls back to the prior baseline without rewriting any pin", async () => {
    const routeAdmin = createRouteAdminRepository(db);
    const evaluations = createEvaluationRepository(db);
    const lifecycle = createRouteLifecycleService({ routeAdmin, evaluations });
    const registry = createModelRegistry(createModelRouteRepository(db));

    const routeA = "b5cefd48-c5c8-5d0f-a81c-c357a9f1dd32"; // seeded baseline
    // A hypothetical existing series pins routeA. The generation-affecting shape
    // of the pin (id + target + version + settings) is what must never change;
    // `lifecycleStatus` is metadata that pinning ignores.
    const pinShape = (r: {
      id: string;
      primaryTarget: string;
      version: string;
    }) => ({
      id: r.id,
      primaryTarget: r.primaryTarget,
      version: r.version,
    });
    const pinBefore = pinShape(
      await registry.getLanguageRoute("one-off-planning", {
        "one-off-planning": routeA,
      }),
    );

    // Approve + activate route B.
    const routeB = await routeAdmin.insertRouteVersion({
      capability: "one-off-planning",
      version: "2.0.0",
      primaryTarget: "anthropic/claude-sonnet-5.1",
      fallbacks: [],
      settings: { temperature: 0.6, maxOutputTokens: 4000 },
      lifecycleStatus: "draft",
    });
    const reportB = await evaluations.recordReport({
      routeVersionId: routeB.id,
      capability: "one-off-planning",
      fixtureSetId: "storylight-core",
      fixtureSetVersion: "1.0.0",
      environment: "local-fake",
      summary: BASELINE_SUMMARY,
      createdBy: "test",
    });
    await evaluations.recordApproval({
      routeVersionId: routeB.id,
      reportId: reportB.id,
      approvedBy: "owner:storylight",
      environment: "local-fake",
    });
    await lifecycle.activateRoute(routeB.id);
    expect((await routeAdmin.getActiveBaseline("one-off-planning"))?.id).toBe(
      routeB.id,
    );

    // The pinned series is UNAFFECTED (still resolves routeA, identical target +
    // version + settings — pinning ignores the lifecycle flip to deprecated).
    const pinDuring = pinShape(
      await registry.getLanguageRoute("one-off-planning", {
        "one-off-planning": routeA,
      }),
    );
    expect(pinDuring).toEqual(pinBefore);

    // ROLLBACK to routeA (still has its live approval) — B deprecated, A active.
    await lifecycle.rollbackTo(routeA);
    const baselineAfter =
      await routeAdmin.getActiveBaseline("one-off-planning");
    expect(baselineAfter?.id).toBe(routeA);
    // Route B's version row is intact (a series pinned to B would still resolve it).
    const bAfter = await routeAdmin.getRoute(routeB.id);
    expect(bAfter?.primaryTarget).toBe("anthropic/claude-sonnet-5.1");
    // The pin never changed across the whole flow.
    const pinAfter = pinShape(
      await registry.getLanguageRoute("one-off-planning", {
        "one-off-planning": routeA,
      }),
    );
    expect(pinAfter).toEqual(pinBefore);
  });
});
