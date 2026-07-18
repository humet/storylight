import type { AuthenticatedActor } from "@/domain/actor";
import {
  type Alert,
  type AlertMetrics,
  evaluateAlerts,
} from "@/domain/alert-conditions";
import { p95 } from "@/domain/evaluation";
import { unauthorisedError } from "@/lib/errors";
import { authorizeFamilyAction } from "./family-access";
import type { FamilyRepository } from "./ports/family-repository";
import type { OpsRepository } from "./ports/ops-repository";

/**
 * OPS SUMMARY query service (M10, `docs/06-engineering/observability.md`
 * "Metrics"/"Dashboards"). Owner-only (`family:manage`), server-side; shapes the
 * raw {@link OpsRepository} snapshot into the documented rates + evaluates the
 * pure {@link evaluateAlerts} predicates. Reads the DB only — no external service.
 *
 * Some metrics are DERIVED from the persisted run/publication tables; a few
 * event-only signals (duplicate-publication ATTEMPTS, provider fallback rate) are
 * not persisted queryably in the MVP and are reported as `null`/0 with a note in
 * the ops UI + production-readiness doc.
 */

export interface OpsMetricsView {
  workflow: {
    total: number;
    completed: number;
    failed: number;
    cancelled: number;
    inFlight: number;
    /** completed / (completed + failed + cancelled); null when none terminal. */
    successRate: number | null;
  };
  /** p95 of text-generation latency (ms). */
  stageLatencyP95Ms: number;
  /** repaired+regenerated+rejected+failed / total text attempts; null when none. */
  retryRate: number | null;
  /** Revision-capability run count (review revision proxy). */
  reviewRevisions: number;
  /** continuity rejections / all continuity attempts; null when none. */
  continuityRejectionRate: number | null;
  /** manual-review+failed illustrations / all publications; null when none. */
  identityFailureRate: number | null;
  /** Accepted-result cost across the family (text + image, all attempts). */
  acceptedResultCostMinorUnits: number;
  budgetBreaches: number;
  backlogJobs: number;
  alerts: Alert[];
}

export interface OpsQueriesDeps {
  familyRepository: FamilyRepository;
  opsRepository: OpsRepository;
}

function requirePrimaryFamily(actor: AuthenticatedActor): string {
  const familyId = actor.familyIds[0];
  if (!familyId) {
    throw unauthorisedError({
      internalDetail: `Actor ${actor.userId} has no family.`,
      stage: "ops.family",
    });
  }
  return familyId;
}

function rate(n: number, d: number): number | null {
  return d === 0 ? null : n / d;
}

export function createOpsQueries(deps: OpsQueriesDeps) {
  return {
    /** The owner-only ops summary for the actor's family. */
    async getOpsSummary(actor: AuthenticatedActor): Promise<OpsMetricsView> {
      const familyId = requirePrimaryFamily(actor);
      await authorizeFamilyAction(deps.familyRepository, {
        userId: actor.userId,
        familyId,
        capability: "family:manage", // owner-only
      });
      const s = await deps.opsRepository.snapshot(familyId);

      const completed = s.workflowsByStatus["completed"] ?? 0;
      const failed = s.workflowsByStatus["failed"] ?? 0;
      const cancelled = s.workflowsByStatus["cancelled"] ?? 0;
      const inFlight =
        (s.workflowsByStatus["queued"] ?? 0) +
        (s.workflowsByStatus["running"] ?? 0) +
        (s.workflowsByStatus["waiting"] ?? 0);
      const terminal = completed + failed + cancelled;
      const total = terminal + inFlight;

      const textTotal = Object.values(s.textByOutcome).reduce(
        (a, b) => a + b,
        0,
      );
      const textRetries =
        s.textByOutcome.repaired +
        s.textByOutcome.regenerated +
        s.textByOutcome.rejected +
        s.textByOutcome.failed;

      const continuityRejections =
        s.continuityByOutcome.rejected + s.continuityByOutcome.failed;
      const continuityTotal = Object.values(s.continuityByOutcome).reduce(
        (a, b) => a + b,
        0,
      );

      const illoTotal = Object.values(s.illustrationsByState).reduce(
        (a, b) => a + b,
        0,
      );
      const identityFailures =
        (s.illustrationsByState["manual-review"] ?? 0) +
        (s.illustrationsByState["failed"] ?? 0);

      const alertMetrics: AlertMetrics = {
        terminalWorkflows: terminal,
        failedWorkflows: failed,
        safetyFailures: s.safetyFailures,
        // Not persisted queryably in the MVP (an event-stream signal).
        duplicatePublicationAttempts: 0,
        continuityRejections,
        continuityApplications: continuityTotal - continuityRejections,
        imageIdentityFailures: identityFailures,
        imageJobs: illoTotal,
        budgetBreaches: s.budgetBreaches,
        probeFailures: 0,
        backlogAgedJobs: s.backlogJobs,
      };

      return {
        workflow: {
          total,
          completed,
          failed,
          cancelled,
          inFlight,
          successRate: rate(completed, terminal),
        },
        stageLatencyP95Ms: p95(s.textLatenciesMs),
        retryRate: rate(textRetries, textTotal),
        reviewRevisions: s.revisionRuns,
        continuityRejectionRate: rate(continuityRejections, continuityTotal),
        identityFailureRate: rate(identityFailures, illoTotal),
        acceptedResultCostMinorUnits:
          s.textCostMinorUnits + s.imageCostMinorUnits,
        budgetBreaches: s.budgetBreaches,
        backlogJobs: s.backlogJobs,
        alerts: evaluateAlerts(alertMetrics),
      };
    },
  };
}

export type OpsQueries = ReturnType<typeof createOpsQueries>;
