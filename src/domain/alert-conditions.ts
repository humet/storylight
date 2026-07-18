/**
 * ALERT CONDITIONS (M10, `docs/06-engineering/observability.md` "Alerts",
 * `docs/06-engineering/cost-management.md` "Alerts"). Pure, evaluable PREDICATES —
 * NOT a pager integration. A check command computes a {@link AlertMetrics}
 * snapshot from existing tables and calls {@link evaluateAlerts}; wiring a fired
 * alert to a pager/email is a deployment concern (documented, not built here).
 *
 * Keeping the conditions pure means every alert threshold is unit-tested and can
 * never silently drift.
 */

export type AlertSeverity = "page" | "warn";

export type AlertId =
  | "sustained-workflow-failures"
  | "safety-failure"
  | "duplicate-publication-attempt"
  | "high-continuity-rejection"
  | "image-identity-regression"
  | "cost-budget-breach"
  | "job-backlog"
  | "capability-probe-failure";

export interface Alert {
  id: AlertId;
  severity: AlertSeverity;
  fired: boolean;
  /** Safe, numeric detail — never prose or private content. */
  detail: string;
}

/** The metric snapshot the alerts evaluate (computed from the DB over a window). */
export interface AlertMetrics {
  /** Workflows that reached a terminal status in the window. */
  terminalWorkflows: number;
  /** Of those, how many FAILED (dead-lettered). */
  failedWorkflows: number;
  /** Safety rejections (review policy "block" / image "manual" on identity). */
  safetyFailures: number;
  /** Blocked duplicate publication attempts (constraint races). */
  duplicatePublicationAttempts: number;
  /** Continuity change-sets rejected as invalid, in the window. */
  continuityRejections: number;
  continuityApplications: number;
  /** Image jobs that ended in manual review due to identity failure. */
  imageIdentityFailures: number;
  imageJobs: number;
  /** Generation runs that failed with `budget-exceeded`. */
  budgetBreaches: number;
  /** Capability-probe failures in the latest probe run. */
  probeFailures: number;
  /** Queued/waiting workflows older than the backlog threshold. */
  backlogAgedJobs: number;
}

/** Tunable thresholds (defaults chosen conservatively; overridable per env). */
export interface AlertThresholds {
  /** Fire when failure RATE ≥ this AND at least `minWorkflows` completed. */
  workflowFailureRate: number;
  minWorkflows: number;
  continuityRejectionRate: number;
  minContinuity: number;
  imageIdentityFailureRate: number;
  minImageJobs: number;
  backlogAgedJobs: number;
}

export const DEFAULT_ALERT_THRESHOLDS: AlertThresholds = {
  workflowFailureRate: 0.2,
  minWorkflows: 10,
  continuityRejectionRate: 0.1,
  minContinuity: 10,
  imageIdentityFailureRate: 0.05,
  minImageJobs: 10,
  backlogAgedJobs: 20,
};

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

/**
 * Evaluate every alert predicate against a metric snapshot. Returns ALL alerts
 * (fired and not) so a dashboard can show green/amber/red; `firedAlerts` filters.
 * Safety failures and duplicate-publication attempts are ANY-count (a single one
 * pages); rate-based alerts require a minimum sample so a tiny window can't fire.
 */
export function evaluateAlerts(
  metrics: AlertMetrics,
  thresholds: AlertThresholds = DEFAULT_ALERT_THRESHOLDS,
): Alert[] {
  const failureRate = rate(metrics.failedWorkflows, metrics.terminalWorkflows);
  const continuityRate = rate(
    metrics.continuityRejections,
    metrics.continuityRejections + metrics.continuityApplications,
  );
  const identityRate = rate(metrics.imageIdentityFailures, metrics.imageJobs);

  return [
    {
      id: "sustained-workflow-failures",
      severity: "page",
      fired:
        metrics.terminalWorkflows >= thresholds.minWorkflows &&
        failureRate >= thresholds.workflowFailureRate,
      detail: `${metrics.failedWorkflows}/${metrics.terminalWorkflows} failed (${(failureRate * 100).toFixed(0)}%)`,
    },
    {
      id: "safety-failure",
      severity: "page",
      fired: metrics.safetyFailures > 0,
      detail: `${metrics.safetyFailures} safety rejection(s)`,
    },
    {
      id: "duplicate-publication-attempt",
      severity: "page",
      fired: metrics.duplicatePublicationAttempts > 0,
      detail: `${metrics.duplicatePublicationAttempts} blocked duplicate publish(es)`,
    },
    {
      id: "high-continuity-rejection",
      severity: "warn",
      fired:
        metrics.continuityRejections + metrics.continuityApplications >=
          thresholds.minContinuity &&
        continuityRate >= thresholds.continuityRejectionRate,
      detail: `${(continuityRate * 100).toFixed(0)}% continuity rejection`,
    },
    {
      id: "image-identity-regression",
      severity: "page",
      fired:
        metrics.imageJobs >= thresholds.minImageJobs &&
        identityRate >= thresholds.imageIdentityFailureRate,
      detail: `${(identityRate * 100).toFixed(0)}% identity failure`,
    },
    {
      id: "cost-budget-breach",
      severity: "warn",
      fired: metrics.budgetBreaches > 0,
      detail: `${metrics.budgetBreaches} budget breach(es)`,
    },
    {
      id: "job-backlog",
      severity: "warn",
      fired: metrics.backlogAgedJobs >= thresholds.backlogAgedJobs,
      detail: `${metrics.backlogAgedJobs} aged queued/waiting job(s)`,
    },
    {
      id: "capability-probe-failure",
      severity: "page",
      fired: metrics.probeFailures > 0,
      detail: `${metrics.probeFailures} route probe failure(s)`,
    },
  ];
}

/** Just the fired alerts (the ones a pager/dashboard would surface). */
export function firedAlerts(
  metrics: AlertMetrics,
  thresholds?: AlertThresholds,
): Alert[] {
  return evaluateAlerts(metrics, thresholds).filter((a) => a.fired);
}
