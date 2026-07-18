/**
 * `pnpm eval` — the evaluation runner CLI (M10, `docs/03-ai/evaluation.md`,
 * excluded from CI so it never makes a paid call there).
 *
 * It runs the SAME source-controlled fixture set + runner the tests use, but
 * against the REAL routes when `AI_GATEWAY_API_KEY` is set (the honest way to
 * evaluate a candidate before it goes live). It prints a human-readable summary
 * and a comparison against the local-fake BASELINE, and — when `DATABASE_URL` is
 * set — persists the report + (optionally) an approval so an owner can gate a
 * route change.
 *
 * Without a gateway key it points you at the fake-path evaluation, which the test
 * suite runs deterministically:
 *   pnpm vitest run src/db/evaluation.integration.test.ts
 *
 * Usage:
 *   AI_GATEWAY_API_KEY=… DATABASE_URL=… pnpm eval
 */
import { createGatewayLanguageModel } from "@/adapters/ai/gateway-language-model";
import { createStructuredGenerator } from "@/application/ai/generate-structured";
import { BASELINE_SUMMARY } from "@/application/evaluation/baseline-evaluation";
import {
  createEvaluationRunner,
  createFakeGrader,
} from "@/application/evaluation/evaluation-runner";
import { DEFAULT_MODEL_ROUTES } from "@/application/model-routes/default-model-routes";
import type { ModelRegistry } from "@/application/model-routes/model-registry";
import { createModelPricing } from "@/application/model-routes/pricing";
import { compareReports } from "@/domain/evaluation";
import type { LanguageCapability } from "@/domain/model-capability";

/** An in-memory registry over the source-controlled default routes (no DB needed). */
function defaultRegistry(): ModelRegistry {
  const byCapability = new Map(
    DEFAULT_MODEL_ROUTES.map((r) => [r.capability, r]),
  );
  return {
    async getLanguageRoute(capability: LanguageCapability) {
      const route = byCapability.get(capability);
      if (!route)
        throw new Error(`No default route for capability "${capability}".`);
      return route;
    },
  };
}

function line(label: string, value: string | number) {
  process.stdout.write(`  ${label.padEnd(24)} ${value}\n`);
}

async function main() {
  const key = process.env.AI_GATEWAY_API_KEY;
  if (!key) {
    process.stdout.write(
      "\nNo AI_GATEWAY_API_KEY set — `pnpm eval` evaluates the REAL routes.\n" +
        "The local-fake evaluation (deterministic, no paid call) runs in the test suite:\n\n" +
        "  pnpm vitest run src/db/evaluation.integration.test.ts\n\n" +
        "That reproduces the source-controlled baseline over the storylight-core fixtures.\n",
    );
    return;
  }

  process.stdout.write(
    "\nRunning evaluation against REAL routes (gateway)…\n\n",
  );
  const runner = createEvaluationRunner({
    structuredGenerator: createStructuredGenerator({
      modelRegistry: defaultRegistry(),
      languageModel: createGatewayLanguageModel(),
      pricing: createModelPricing(),
    }),
    // A real grader would wrap a review model; the CLI uses the pass-through fake
    // unless/until a graded rubric route is wired.
    grader: createFakeGrader(),
  });

  const result = await runner.run({
    environment: "gateway",
    createdBy: `cli:${process.env.USER ?? "eval"}`,
    routeVersionId: null,
  });

  const s = result.summary;
  process.stdout.write("Summary (gateway)\n");
  line("total cases", s.totalCases);
  line("passed", s.passedCases);
  line("blocked", s.blockedCases);
  line("blocking codes", s.blockingCodes.join(", ") || "none");
  line("accepted cost (minor)", s.totalCostMinorUnits);
  line("p95 latency (ms)", s.p95LatencyMs);
  line("failed cases", s.failedCaseIds.join(", ") || "none");

  process.stdout.write("\nRelease gate vs local-fake baseline\n");
  const decision = compareReports(BASELINE_SUMMARY, s);
  line("can replace baseline", decision.canReplace ? "YES" : "NO");
  for (const reason of decision.reasons)
    process.stdout.write(`  - ${reason}\n`);
  if (decision.regressions.length > 0) {
    line("regressions", decision.regressions.join(", "));
  }

  process.stdout.write(
    "\nTo record this report + an approval and gate a route change, use the ops\n" +
      "tooling (an owner action) — it writes an `evaluation_reports` row and a live\n" +
      "`evaluation_approvals` row, which `activateRoute` then requires.\n",
  );

  process.exitCode = decision.canReplace ? 0 : 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`\neval failed: ${String(error)}\n`);
  process.exitCode = 1;
});
