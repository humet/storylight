import type { CanaryRule } from "@/domain/model-route";
import { invalidCommandError } from "@/lib/errors";
import type { EvaluationRepository } from "../ports/evaluation-repository";
import type { RouteAdminRepository } from "../ports/route-admin-repository";

/**
 * ROUTE LIFECYCLE service (M10, `docs/03-ai/models.md` "Evaluation gate",
 * `docs/06-engineering/deployment.md` "Rollback"). The one place a model route's
 * lifecycle changes, and it ENFORCES the gate:
 *
 *  - `activateRoute` refuses to make a route the active baseline unless it has a
 *    LIVE evaluation approval (`evaluation_approvals`) — closing M6's bootstrap
 *    gap where routes were seeded `active` without a real evaluation.
 *  - `configureCanary` requires the same approval for the canary route.
 *  - `rollbackTo` restores a previously-approved route as the baseline and
 *    deprecates the incumbent — WITHOUT touching any series' pinned route
 *    versions (M8 pinning makes existing series immune to route changes), so a
 *    rollback is independent of application rollback (`deployment.md`).
 *
 * These are admin/tooling operations (the `pnpm eval` CLI, an owner ops action),
 * never request-time writes.
 */
export interface RouteLifecycleDeps {
  routeAdmin: RouteAdminRepository;
  evaluations: EvaluationRepository;
}

async function requireApprovedRoute(
  deps: RouteLifecycleDeps,
  routeVersionId: string,
) {
  const route = await deps.routeAdmin.getRoute(routeVersionId);
  if (!route) {
    throw invalidCommandError({
      safeMessage: "That route version does not exist.",
      internalDetail: `Route version ${routeVersionId} not found.`,
      stage: "route.lifecycle",
    });
  }
  const approval = await deps.evaluations.getLiveApproval(routeVersionId);
  if (!approval) {
    throw invalidCommandError({
      safeMessage: "This route has not passed evaluation.",
      internalDetail: `Route version ${routeVersionId} has no live evaluation approval; activation is blocked by the evaluation gate.`,
      stage: "route.lifecycle",
    });
  }
  return { route, approval };
}

export function createRouteLifecycleService(deps: RouteLifecycleDeps) {
  return {
    /**
     * Make a route the capability's active BASELINE. Requires a live evaluation
     * approval (the gate). Returns the id of the route it deprecated, if any.
     */
    async activateRoute(routeVersionId: string): Promise<{
      routeVersionId: string;
      deprecatedRouteVersionId: string | null;
    }> {
      const { route } = await requireApprovedRoute(deps, routeVersionId);
      const deprecated = await deps.routeAdmin.promoteToActiveBaseline(
        route.capability,
        routeVersionId,
      );
      return { routeVersionId, deprecatedRouteVersionId: deprecated };
    },

    /** Deprecate a route (no longer served to NEW stories). */
    async deprecateRoute(routeVersionId: string): Promise<void> {
      await deps.routeAdmin.setLifecycleStatus(routeVersionId, "deprecated");
      // A deprecated route can no longer front a live approval as the baseline.
      // The approval row remains (audit) but the route is not active.
    },

    /**
     * ROLLBACK: restore a previously-approved route as the baseline (deprecating
     * the current incumbent) without touching any series pins. Identical to
     * `activateRoute` but named for intent and used by the rollback path/tests.
     */
    async rollbackTo(routeVersionId: string): Promise<{
      routeVersionId: string;
      deprecatedRouteVersionId: string | null;
    }> {
      return this.activateRoute(routeVersionId);
    },

    /**
     * Configure a route as the capability's active CANARY with a rollout rule.
     * Requires a live approval. Applies ONLY to newly created stories/series (the
     * model registry consults the canary at CREATION time and pins the arm).
     */
    async configureCanary(
      routeVersionId: string,
      rule: CanaryRule,
    ): Promise<void> {
      if (rule.rolloutPercent < 0 || rule.rolloutPercent > 100) {
        throw invalidCommandError({
          safeMessage: "That rollout percentage is out of range.",
          internalDetail: `rolloutPercent ${rule.rolloutPercent} must be 0–100.`,
          stage: "route.canary",
        });
      }
      const { route } = await requireApprovedRoute(deps, routeVersionId);
      await deps.routeAdmin.setActiveCanary(
        route.capability,
        routeVersionId,
        rule,
      );
    },

    /** Stop a canary by deprecating it (baseline is untouched). */
    async stopCanary(routeVersionId: string): Promise<void> {
      await deps.routeAdmin.setLifecycleStatus(routeVersionId, "deprecated");
    },
  };
}

export type RouteLifecycleService = ReturnType<
  typeof createRouteLifecycleService
>;
