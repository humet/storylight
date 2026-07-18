import { and, eq } from "drizzle-orm";

import type { ModelRouteRepository } from "@/application/ports/model-route-repository";
import type { LanguageCapability } from "@/domain/model-capability";
import type { ModelRouteVersion } from "@/domain/model-route";
import type { Database } from "../client";
import { modelRouteVersions } from "../schema";

/**
 * Drizzle implementation of {@link ModelRouteRepository}. Read-only at runtime —
 * routes are seeded source-controlled data (see the M6 seed migration); lifecycle
 * changes are controlled migrations / M10 tooling, never request-time writes.
 */

type Row = typeof modelRouteVersions.$inferSelect;

function toRoute(row: Row): ModelRouteVersion {
  return {
    id: row.id,
    capability: row.capability as LanguageCapability,
    version: row.version,
    primaryTarget: row.primaryTarget,
    fallbacks: row.fallbacks,
    settings: row.settings,
    lifecycleStatus:
      row.lifecycleStatus as ModelRouteVersion["lifecycleStatus"],
    evaluationProfile: row.evaluationProfile ?? null,
    approvalRecord: row.approvalRecord ?? null,
    isCanary: row.isCanary,
    canaryRule: row.canaryRule ?? null,
  };
}

export function createModelRouteRepository(db: Database): ModelRouteRepository {
  return {
    async getActiveRoute(capability) {
      const [row] = await db
        .select()
        .from(modelRouteVersions)
        .where(
          and(
            eq(modelRouteVersions.capability, capability),
            eq(modelRouteVersions.lifecycleStatus, "active"),
          ),
        )
        .limit(1);
      return row ? toRoute(row) : null;
    },

    async getRouteById(id) {
      const [row] = await db
        .select()
        .from(modelRouteVersions)
        .where(eq(modelRouteVersions.id, id))
        .limit(1);
      return row ? toRoute(row) : null;
    },

    async listRoutesForCapability(capability) {
      const rows = await db
        .select()
        .from(modelRouteVersions)
        .where(eq(modelRouteVersions.capability, capability));
      return rows.map(toRoute);
    },
  };
}
