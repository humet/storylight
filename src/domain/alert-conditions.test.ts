import { describe, expect, it } from "vitest";

import {
  type AlertMetrics,
  evaluateAlerts,
  firedAlerts,
} from "./alert-conditions";

const HEALTHY: AlertMetrics = {
  terminalWorkflows: 100,
  failedWorkflows: 2,
  safetyFailures: 0,
  duplicatePublicationAttempts: 0,
  continuityRejections: 1,
  continuityApplications: 99,
  imageIdentityFailures: 1,
  imageJobs: 100,
  budgetBreaches: 0,
  probeFailures: 0,
  backlogAgedJobs: 0,
};

describe("evaluateAlerts", () => {
  it("fires nothing when everything is healthy", () => {
    expect(firedAlerts(HEALTHY)).toEqual([]);
  });

  it("pages on ANY safety failure", () => {
    const fired = firedAlerts({ ...HEALTHY, safetyFailures: 1 });
    expect(fired.map((a) => a.id)).toContain("safety-failure");
  });

  it("pages on ANY duplicate publication attempt", () => {
    const fired = firedAlerts({ ...HEALTHY, duplicatePublicationAttempts: 1 });
    expect(fired.map((a) => a.id)).toContain("duplicate-publication-attempt");
  });

  it("pages on sustained workflow failures over the rate + minimum", () => {
    const fired = firedAlerts({
      ...HEALTHY,
      terminalWorkflows: 20,
      failedWorkflows: 6, // 30% ≥ 20%
    });
    expect(fired.map((a) => a.id)).toContain("sustained-workflow-failures");
  });

  it("does NOT fire the failure-rate alert below the minimum sample", () => {
    const fired = firedAlerts({
      ...HEALTHY,
      terminalWorkflows: 3,
      failedWorkflows: 3, // 100% but only 3 jobs → below minWorkflows
    });
    expect(fired.map((a) => a.id)).not.toContain("sustained-workflow-failures");
  });

  it("warns on a budget breach and on an aged backlog", () => {
    const fired = firedAlerts({
      ...HEALTHY,
      budgetBreaches: 1,
      backlogAgedJobs: 25,
    });
    const ids = fired.map((a) => a.id);
    expect(ids).toContain("cost-budget-breach");
    expect(ids).toContain("job-backlog");
  });

  it("pages on an image identity regression over the rate", () => {
    const fired = firedAlerts({
      ...HEALTHY,
      imageJobs: 100,
      imageIdentityFailures: 8, // 8% ≥ 5%
    });
    expect(fired.map((a) => a.id)).toContain("image-identity-regression");
  });

  it("pages on a capability-probe failure", () => {
    const fired = firedAlerts({ ...HEALTHY, probeFailures: 1 });
    expect(fired.map((a) => a.id)).toContain("capability-probe-failure");
  });

  it("returns all eight predicates (fired flags) for a dashboard", () => {
    expect(evaluateAlerts(HEALTHY)).toHaveLength(8);
  });
});
