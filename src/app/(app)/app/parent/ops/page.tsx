import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import type { OpsMetricsView } from "@/application/ops-queries";
import { isDomainError } from "@/lib/errors";
import { actorOrRedirect } from "../../guard";
import { getOpsQueries } from "./service";

/**
 * Owner-only internal OPS SUMMARY (M10, `docs/06-engineering/observability.md`
 * "Dashboards"). Server-rendered, reads the DB via the ops query service (which
 * authorises `family:manage` — owner-only). A non-owner is redirected to /app.
 * No external service; the "dashboard" is this page.
 */

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Operations — Storylight" };

function pct(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

function money(minor: number): string {
  return `${(minor / 100).toFixed(2)}`;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3">
      <div className="font-sans text-xs uppercase tracking-wide text-ink-soft">
        {label}
      </div>
      <div className="font-display text-2xl font-semibold text-ink">
        {value}
      </div>
    </div>
  );
}

export default async function OpsPage() {
  const actor = await actorOrRedirect();
  const queries = await getOpsQueries();
  let view: OpsMetricsView;
  try {
    view = await queries.getOpsSummary(actor);
  } catch (error) {
    if (isDomainError(error) && error.code === "UNAUTHORISED") redirect("/app");
    throw error;
  }

  const fired = view.alerts.filter((a) => a.fired);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-5 py-10">
      <Link href="/app" className="font-sans text-sm font-medium text-accent">
        ← Home
      </Link>
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-semibold text-balance text-ink">
          Operations
        </h1>
        <p className="font-sans text-base text-pretty text-ink-soft">
          A private, owner-only summary of this family&rsquo;s generation
          health, computed live from the database.
        </p>
      </div>

      <section aria-labelledby="alerts-heading" className="flex flex-col gap-3">
        <h2
          id="alerts-heading"
          className="font-sans text-sm font-semibold uppercase tracking-wide text-ink-soft"
        >
          Alerts
        </h2>
        {fired.length === 0 ? (
          <p className="rounded-xl border border-border bg-surface px-4 py-3 font-sans text-sm text-ink-soft">
            All clear — no alert conditions are currently met.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {fired.map((alert) => (
              <li
                key={alert.id}
                className="rounded-xl border border-accent-soft bg-accent-soft px-4 py-3 font-sans text-sm text-ink"
              >
                <span className="font-semibold">
                  {alert.severity === "page" ? "🔴" : "🟠"} {alert.id}
                </span>
                <span className="text-ink-soft"> — {alert.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        aria-labelledby="metrics-heading"
        className="flex flex-col gap-3"
      >
        <h2
          id="metrics-heading"
          className="font-sans text-sm font-semibold uppercase tracking-wide text-ink-soft"
        >
          Metrics
        </h2>
        <div className="grid grid-cols-2 gap-3">
          <Metric
            label="Workflow success"
            value={pct(view.workflow.successRate)}
          />
          <Metric label="In flight" value={String(view.workflow.inFlight)} />
          <Metric
            label="Stage latency p95"
            value={`${view.stageLatencyP95Ms} ms`}
          />
          <Metric label="Retry rate" value={pct(view.retryRate)} />
          <Metric
            label="Continuity rejection"
            value={pct(view.continuityRejectionRate)}
          />
          <Metric
            label="Identity failure"
            value={pct(view.identityFailureRate)}
          />
          <Metric
            label="Review revisions"
            value={String(view.reviewRevisions)}
          />
          <Metric label="Budget breaches" value={String(view.budgetBreaches)} />
          <Metric label="Job backlog" value={String(view.backlogJobs)} />
          <Metric
            label="Accepted cost"
            value={money(view.acceptedResultCostMinorUnits)}
          />
        </div>
        <p className="font-sans text-xs text-ink-soft">
          Costs are accepted-result totals including retries, repair, and
          escalation. Duplicate-publication attempts and provider fallback rate
          are event-stream signals not yet persisted for querying.
        </p>
      </section>
    </main>
  );
}
