import type { LanguageCapability } from "@/domain/model-capability";
import type { ModelRouteVersion } from "@/domain/model-route";

/**
 * Read PORT over `model_route_versions` (owned by the application; the Drizzle
 * impl lives in `src/db/repositories/model-route-repository.ts`). Routes are
 * source-controlled seed data — this port is READ-ONLY at runtime; new routes and
 * lifecycle changes are migrations / M10 tooling, never a request-time write. The
 * model registry resolves through this port.
 */
export interface ModelRouteRepository {
  /**
   * The single ACTIVE route for a capability (partial-unique in the DB:
   * at most one active per capability). Null when none is active.
   */
  getActiveRoute(
    capability: LanguageCapability,
  ): Promise<ModelRouteVersion | null>;

  /** A specific route version by id (for series PINS). Null when unknown. */
  getRouteById(id: string): Promise<ModelRouteVersion | null>;

  /** All routes for a capability (evaluation / admin surfaces). */
  listRoutesForCapability(
    capability: LanguageCapability,
  ): Promise<ModelRouteVersion[]>;
}
