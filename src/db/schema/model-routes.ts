import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { LANGUAGE_CAPABILITIES } from "@/domain/model-capability";
import type { ApprovalRecord, GenerationSettings } from "@/domain/model-route";
import { ROUTE_LIFECYCLE_STATUSES } from "@/domain/model-route";

/**
 * MODEL ROUTE VERSIONS (`docs/03-ai/models.md`, ADR-004/006). Capability-based
 * routing lives in the DB so existing series can PIN a specific version (M8) and
 * so the seeded default set is source-controlled AND queryable. Rows are
 * effectively immutable route definitions; lifecycle changes are controlled
 * (seed migrations / M10 tooling), never request-time writes.
 *
 * A Postgres enum constrains `capability` to the language set, and a PARTIAL
 * unique index enforces "at most one ACTIVE route per capability" in the database
 * (a constraint, not just an application check — AGENTS.md).
 */

/** The language-capability vocabulary as a Postgres enum (`model-capability.ts`). */
export const languageCapability = pgEnum(
  "language_capability",
  LANGUAGE_CAPABILITIES,
);

export const routeLifecycleStatus = pgEnum(
  "route_lifecycle_status",
  ROUTE_LIFECYCLE_STATUSES as unknown as [string, ...string[]],
);

export const modelRouteVersions = pgTable(
  "model_route_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    capability: languageCapability("capability").notNull(),
    /** Semantic version of this route ("1.0.0"). */
    version: text("version").notNull(),
    /** Primary gateway slug — never a mutable `latest` alias. */
    primaryTarget: text("primary_target").notNull(),
    /** Availability-only fallback slugs (ordered). */
    fallbacks: jsonb("fallbacks").$type<string[]>().notNull(),
    settings: jsonb("settings").$type<GenerationSettings>().notNull(),
    lifecycleStatus: routeLifecycleStatus("lifecycle_status").notNull(),
    evaluationProfile: text("evaluation_profile"),
    approvalRecord: jsonb("approval_record").$type<ApprovalRecord>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("model_route_versions_capability_version_unq").on(
      table.capability,
      table.version,
    ),
    // At most ONE active route per capability (DB-enforced).
    uniqueIndex("model_route_versions_one_active_per_capability")
      .on(table.capability)
      .where(sql`${table.lifecycleStatus} = 'active'`),
    index("model_route_versions_capability_idx").on(table.capability),
  ],
);
