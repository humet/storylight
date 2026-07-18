import { z } from "zod";

import {
  createCapabilityProbe,
  type CapabilityProbeDeps,
} from "../ops/capability-probe";
import type { WorkflowDefinition } from "../workflow-engine";

/**
 * `run-capability-probe` — a registered workflow (M10,
 * `docs/06-engineering/deployment.md` "Health checks") that exercises each active
 * route with synthetic data via the port (fake locally) and records pass/fail +
 * latency as its stage output. A probe failure surfaces the pure
 * `capability-probe-failure` alert in the output for the caller to act on. Owner-
 * only (`family:manage`).
 */

export const RUN_CAPABILITY_PROBE_TYPE = "run-capability-probe";

export const RunCapabilityProbeInputSchema = z.object({});
export type RunCapabilityProbeInput = z.infer<
  typeof RunCapabilityProbeInputSchema
>;

export function createRunCapabilityProbeWorkflow(
  deps: CapabilityProbeDeps,
): WorkflowDefinition<RunCapabilityProbeInput> {
  const probe = createCapabilityProbe(deps);
  return {
    type: RUN_CAPABILITY_PROBE_TYPE,
    capability: "family:manage",
    inputSchema: RunCapabilityProbeInputSchema,
    pendingLabel: "Checking model availability",
    dispatchPriority: "background",
    stages: [
      {
        key: "probe",
        label: "Checking model availability",
        run: async () => {
          const report = await probe.run();
          // The output IS the record (pass/fail + latency per route + fired
          // alerts). No separate table needed for the MVP health check.
          return { output: report };
        },
      },
    ],
  };
}
