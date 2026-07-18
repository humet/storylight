import { z } from "zod";

import { type AlertMetrics, firedAlerts } from "@/domain/alert-conditions";
import {
  LANGUAGE_CAPABILITIES,
  type LanguageCapability,
} from "@/domain/model-capability";
import type { LanguageModel } from "../ports/language-model";
import type { ModelRouteRepository } from "../ports/model-route-repository";

/**
 * CAPABILITY PROBE (M10, `docs/06-engineering/deployment.md` "Health checks":
 * "lightweight model capability probes"; `docs/06-engineering/observability.md`).
 * Exercises each ACTIVE route with SYNTHETIC data through the {@link LanguageModel}
 * port — a liveness/capability check, NOT a domain evaluation — recording pass/
 * fail + latency. On fakes it runs offline; against the gateway it verifies each
 * routed target actually responds. A probe failure feeds the pure
 * `capability-probe-failure` alert predicate.
 */

export interface ProbeResult {
  capability: LanguageCapability;
  target: string;
  ok: boolean;
  latencyMs: number;
  /** Safe failure detail (no provider internals). */
  detail?: string;
}

export interface ProbeReport {
  results: ProbeResult[];
  failures: number;
  /** Fired alerts derived from the probe (just the probe predicate here). */
  alerts: ReturnType<typeof firedAlerts>;
}

const PROBE_SCHEMA = z.object({ ok: z.boolean() });

export interface CapabilityProbeDeps {
  modelRouteRepository: ModelRouteRepository;
  languageModel: LanguageModel;
}

export function createCapabilityProbe(deps: CapabilityProbeDeps) {
  const { modelRouteRepository, languageModel } = deps;

  async function probeCapability(
    capability: LanguageCapability,
  ): Promise<ProbeResult | null> {
    const route = await modelRouteRepository.getActiveRoute(capability);
    if (!route) return null; // no active route → nothing to probe
    const started = Date.now();
    try {
      await languageModel.generate({
        target: route.primaryTarget,
        system: "You are a health probe. Reply with the smallest valid object.",
        prompt: 'Return {"ok": true}.',
        schema: PROBE_SCHEMA,
        schemaName: "probe",
        schemaDescription: "A trivial liveness object.",
        settings: { maxOutputTokens: 16, temperature: 0 },
      });
      return {
        capability,
        target: route.primaryTarget,
        ok: true,
        latencyMs: Date.now() - started,
      };
    } catch (error) {
      return {
        capability,
        target: route.primaryTarget,
        ok: false,
        latencyMs: Date.now() - started,
        detail: error instanceof Error ? error.name : "probe failed",
      };
    }
  }

  return {
    async run(): Promise<ProbeReport> {
      const results: ProbeResult[] = [];
      for (const capability of LANGUAGE_CAPABILITIES) {
        const result = await probeCapability(capability);
        if (result) results.push(result);
      }
      const failures = results.filter((r) => !r.ok).length;
      // Only the probe predicate is meaningful here; the rest are zeroed.
      const metrics: AlertMetrics = {
        terminalWorkflows: 0,
        failedWorkflows: 0,
        safetyFailures: 0,
        duplicatePublicationAttempts: 0,
        continuityRejections: 0,
        continuityApplications: 0,
        imageIdentityFailures: 0,
        imageJobs: 0,
        budgetBreaches: 0,
        probeFailures: failures,
        backlogAgedJobs: 0,
      };
      return { results, failures, alerts: firedAlerts(metrics) };
    },
  };
}

export type CapabilityProbe = ReturnType<typeof createCapabilityProbe>;
