import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  type PgColumn,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type {
  EvaluationEnvironment,
  EvaluationSummary,
} from "@/domain/evaluation";
import { languageCapability, modelRouteVersions } from "./model-routes";

// A tiny local helper so the partial-unique predicate reads clearly.
function timestampIsNull(column: PgColumn) {
  return sql`${column} is null`;
}

/**
 * EVALUATION tables (M10, `docs/03-ai/evaluation.md`, `docs/06-engineering/deployment.md`).
 *
 *  - `evaluation_reports`   — one persisted row per run of a source-controlled
 *                             fixture set against a route version, on five axes.
 *                             `summary` is the folded {@link EvaluationSummary}
 *                             (blocking failures counted separately, never
 *                             averaged away). `environment` is honest provenance:
 *                             `local-fake` (scriptable fakes, the only thing CI
 *                             runs) or `gateway` (a real-route `pnpm eval`).
 *  - `evaluation_approvals` — the EVALUATION GATE record: a route version may only
 *                             be ACTIVATED when it has an approval linking it to a
 *                             passing report and a human owner. Replaces M6's
 *                             bootstrap `approval_record` (those are marked
 *                             superseded). A partial-unique keeps at most ONE live
 *                             (non-superseded) approval per route version.
 */

export const evaluationReports = pgTable(
  "evaluation_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The route version this report evaluated (null for a route-agnostic run). */
    routeVersionId: uuid("route_version_id").references(
      () => modelRouteVersions.id,
      { onDelete: "set null" },
    ),
    capability: languageCapability("capability"),
    fixtureSetId: text("fixture_set_id").notNull(),
    fixtureSetVersion: text("fixture_set_version").notNull(),
    /** "local-fake" | "gateway" — honest provenance. */
    environment: text("environment").$type<EvaluationEnvironment>().notNull(),
    summary: jsonb("summary").$type<EvaluationSummary>().notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("evaluation_reports_route_idx").on(table.routeVersionId),
    index("evaluation_reports_capability_idx").on(table.capability),
  ],
);

export const evaluationApprovals = pgTable(
  "evaluation_approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    routeVersionId: uuid("route_version_id")
      .notNull()
      .references(() => modelRouteVersions.id, { onDelete: "cascade" }),
    reportId: uuid("report_id")
      .notNull()
      .references(() => evaluationReports.id, { onDelete: "restrict" }),
    approvedBy: text("approved_by").notNull(),
    /** "local-fake" | "gateway" — matches the report's provenance. */
    environment: text("environment").$type<EvaluationEnvironment>().notNull(),
    note: text("note"),
    /** Set when a later approval (or a deprecation) supersedes this one. */
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // At most ONE live (non-superseded) approval per route version.
    uniqueIndex("evaluation_approvals_one_live_per_route")
      .on(table.routeVersionId)
      .where(timestampIsNull(table.supersededAt)),
    index("evaluation_approvals_route_idx").on(table.routeVersionId),
  ],
);
