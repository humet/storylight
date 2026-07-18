import { and, eq, ne } from "drizzle-orm";

import type { RouteAdminRepository } from "@/application/ports/route-admin-repository";
import type { LanguageCapability } from "@/domain/model-capability";
import type { ModelRouteVersion } from "@/domain/model-route";
import type { Database } from "../client";
import { modelRouteVersions } from "../schema";

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

export function createRouteAdminRepository(db: Database): RouteAdminRepository {
  return {
    async getRoute(id) {
      const [row] = await db
        .select()
        .from(modelRouteVersions)
        .where(eq(modelRouteVersions.id, id))
        .limit(1);
      return row ? toRoute(row) : null;
    },

    async getActiveBaseline(capability) {
      const [row] = await db
        .select()
        .from(modelRouteVersions)
        .where(
          and(
            eq(modelRouteVersions.capability, capability),
            eq(modelRouteVersions.lifecycleStatus, "active"),
            eq(modelRouteVersions.isCanary, false),
          ),
        )
        .limit(1);
      return row ? toRoute(row) : null;
    },

    async getActiveCanary(capability) {
      const [row] = await db
        .select()
        .from(modelRouteVersions)
        .where(
          and(
            eq(modelRouteVersions.capability, capability),
            eq(modelRouteVersions.lifecycleStatus, "active"),
            eq(modelRouteVersions.isCanary, true),
          ),
        )
        .limit(1);
      return row ? toRoute(row) : null;
    },

    async insertRouteVersion(input) {
      const [row] = await db
        .insert(modelRouteVersions)
        .values({
          ...(input.id ? { id: input.id } : {}),
          capability: input.capability,
          version: input.version,
          primaryTarget: input.primaryTarget,
          fallbacks: input.fallbacks,
          settings: input.settings,
          lifecycleStatus: input.lifecycleStatus,
          isCanary: false,
        })
        .returning();
      return toRoute(row);
    },

    async promoteToActiveBaseline(capability, routeVersionId) {
      return db.transaction(async (tx) => {
        // Deprecate the current active baseline (if any and different) FIRST so
        // the one-active-baseline partial-unique is never transiently violated.
        const demoted = await tx
          .update(modelRouteVersions)
          .set({ lifecycleStatus: "deprecated" })
          .where(
            and(
              eq(modelRouteVersions.capability, capability),
              eq(modelRouteVersions.lifecycleStatus, "active"),
              eq(modelRouteVersions.isCanary, false),
              ne(modelRouteVersions.id, routeVersionId),
            ),
          )
          .returning();
        await tx
          .update(modelRouteVersions)
          .set({
            lifecycleStatus: "active",
            isCanary: false,
            canaryRule: null,
          })
          .where(eq(modelRouteVersions.id, routeVersionId));
        return demoted[0]?.id ?? null;
      });
    },

    async setActiveCanary(capability, routeVersionId, rule) {
      await db.transaction(async (tx) => {
        // Deprecate any existing active canary (different row) first.
        await tx
          .update(modelRouteVersions)
          .set({
            lifecycleStatus: "deprecated",
            isCanary: false,
            canaryRule: null,
          })
          .where(
            and(
              eq(modelRouteVersions.capability, capability),
              eq(modelRouteVersions.lifecycleStatus, "active"),
              eq(modelRouteVersions.isCanary, true),
              ne(modelRouteVersions.id, routeVersionId),
            ),
          );
        await tx
          .update(modelRouteVersions)
          .set({
            lifecycleStatus: "active",
            isCanary: true,
            canaryRule: rule,
          })
          .where(eq(modelRouteVersions.id, routeVersionId));
      });
    },

    async setLifecycleStatus(routeVersionId, status) {
      await db
        .update(modelRouteVersions)
        .set({ lifecycleStatus: status })
        .where(eq(modelRouteVersions.id, routeVersionId));
    },
  };
}
