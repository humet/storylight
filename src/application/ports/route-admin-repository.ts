import type { LanguageCapability } from "@/domain/model-capability";
import type {
  CanaryRule,
  ModelRouteVersion,
  RouteLifecycleStatus,
} from "@/domain/model-route";

/**
 * WRITE port for model-route LIFECYCLE tooling (M10). Deliberately separate from
 * the read-only {@link import("./model-route-repository").ModelRouteRepository}
 * used at request time: lifecycle changes (activate / deprecate / canary) are
 * controlled ADMIN operations gated by the evaluation approval, never request-time
 * writes. The Drizzle impl performs the multi-row transitions in a single
 * transaction so the DB's "one active baseline / one active canary per capability"
 * partial-uniques are never transiently violated.
 */
export interface RouteAdminRepository {
  getRoute(id: string): Promise<ModelRouteVersion | null>;

  /** The active NON-CANARY (baseline) route for a capability, or null. */
  getActiveBaseline(
    capability: LanguageCapability,
  ): Promise<ModelRouteVersion | null>;

  /** The active CANARY route for a capability, or null. */
  getActiveCanary(
    capability: LanguageCapability,
  ): Promise<ModelRouteVersion | null>;

  /** Insert a new route version (tooling / tests). Returns the stored route. */
  insertRouteVersion(input: {
    id?: string;
    capability: LanguageCapability;
    version: string;
    primaryTarget: string;
    fallbacks: string[];
    settings: ModelRouteVersion["settings"];
    lifecycleStatus: RouteLifecycleStatus;
  }): Promise<ModelRouteVersion>;

  /**
   * Promote a route to the capability's active BASELINE in ONE transaction:
   * deprecate the current active baseline (if any and different), and set the
   * target `active`, non-canary. Returns the previously-active baseline id (for
   * a rollback record), or null when there was none.
   */
  promoteToActiveBaseline(
    capability: LanguageCapability,
    routeVersionId: string,
  ): Promise<string | null>;

  /**
   * Make a route the capability's active CANARY with a rollout rule, in ONE
   * transaction (deprecating any existing active canary first).
   */
  setActiveCanary(
    capability: LanguageCapability,
    routeVersionId: string,
    rule: CanaryRule,
  ): Promise<void>;

  /** Move a route to a terminal-ish status (`deprecated` / `retired`). */
  setLifecycleStatus(
    routeVersionId: string,
    status: RouteLifecycleStatus,
  ): Promise<void>;
}
