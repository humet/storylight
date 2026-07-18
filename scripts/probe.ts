/**
 * `pnpm probe` — the capability-probe / alert-check command (M10,
 * `docs/06-engineering/deployment.md` "Health checks",
 * `docs/06-engineering/observability.md` "Alerts").
 *
 * Exercises each active route with synthetic data through the language-model port
 * and REPORTS pass/fail + latency, then evaluates the pure alert predicates on the
 * probe result. Against the gateway (`AI_GATEWAY_API_KEY`) it verifies each routed
 * target responds; otherwise it runs a fake so the command is always exercisable.
 * Wiring a fired alert to a pager is a deployment concern (documented, not built).
 */
import { createFakeLanguageModel } from "@/adapters/ai/fake-language-model";
import { createGatewayLanguageModel } from "@/adapters/ai/gateway-language-model";
import { createCapabilityProbe } from "@/application/ops/capability-probe";
import type { ModelRouteRepository } from "@/application/ports/model-route-repository";
import { DEFAULT_MODEL_ROUTES } from "@/application/model-routes/default-model-routes";
import type { LanguageCapability } from "@/domain/model-capability";

/** In-memory route repository over the source-controlled default routes. */
function defaultRouteRepository(): ModelRouteRepository {
  const byCapability = new Map(
    DEFAULT_MODEL_ROUTES.map((r) => [r.capability, r]),
  );
  return {
    async getActiveRoute(capability: LanguageCapability) {
      return byCapability.get(capability) ?? null;
    },
    async getRouteById(id: string) {
      return DEFAULT_MODEL_ROUTES.find((r) => r.id === id) ?? null;
    },
    async listRoutesForCapability(capability: LanguageCapability) {
      return DEFAULT_MODEL_ROUTES.filter((r) => r.capability === capability);
    },
  };
}

async function main() {
  const keyed = Boolean(process.env.AI_GATEWAY_API_KEY);
  const languageModel = keyed
    ? createGatewayLanguageModel()
    : createFakeLanguageModel({ kind: "text", text: '{"ok":true}' });

  process.stdout.write(
    `\nCapability probe (${keyed ? "gateway" : "fake"})\n\n`,
  );
  const probe = createCapabilityProbe({
    modelRouteRepository: defaultRouteRepository(),
    languageModel,
  });
  const report = await probe.run();

  for (const r of report.results) {
    const mark = r.ok ? "✓" : "✗";
    process.stdout.write(
      `  ${mark} ${r.capability.padEnd(24)} ${r.target.padEnd(34)} ${r.latencyMs}ms${r.detail ? ` (${r.detail})` : ""}\n`,
    );
  }

  process.stdout.write(`\n${report.failures} failure(s).\n`);
  if (report.alerts.length > 0) {
    process.stdout.write("Alerts:\n");
    for (const a of report.alerts) {
      process.stdout.write(
        `  ${a.severity.toUpperCase()} ${a.id} — ${a.detail}\n`,
      );
    }
  } else {
    process.stdout.write("No alerts.\n");
  }

  process.exitCode = report.failures > 0 ? 1 : 0;
}

main().catch((error: unknown) => {
  process.stderr.write(`\nprobe failed: ${String(error)}\n`);
  process.exitCode = 1;
});
