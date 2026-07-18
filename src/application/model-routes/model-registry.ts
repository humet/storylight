import type { LanguageCapability } from "@/domain/model-capability";
import type {
  ModelRouteVersion,
  PinnedRouteProfile,
} from "@/domain/model-route";
import { invalidCommandError } from "@/lib/errors";
import type { ModelRouteRepository } from "../ports/model-route-repository";

/**
 * The MODEL REGISTRY (`docs/03-ai/models.md`, ADR-004). Domain services request a
 * CAPABILITY; the registry resolves the concrete route version. It never branches
 * on a model identifier and never returns a mutable `latest` alias — it returns a
 * pinned route VERSION whose slugs are fixed.
 *
 * `getLanguageRoute(capability, pinnedProfile?)`:
 *  - with a pinned profile that names this capability → resolve that EXACT version
 *    (series pinning, M8) regardless of lifecycle, so an existing series never
 *    drifts when the active route changes;
 *  - otherwise → the single ACTIVE route for the capability.
 *
 * Async because routes live in Postgres. The resolved provider model id returned
 * by the API is recorded per RUN by the pipeline, not here (`models.md` "Stable
 * identifiers").
 */
export interface ModelRegistry {
  getLanguageRoute(
    capability: LanguageCapability,
    pinnedProfile?: PinnedRouteProfile,
  ): Promise<ModelRouteVersion>;
}

export function createModelRegistry(
  routeRepository: ModelRouteRepository,
): ModelRegistry {
  return {
    async getLanguageRoute(capability, pinnedProfile) {
      const pinnedId = pinnedProfile?.[capability];
      if (pinnedId) {
        const pinned = await routeRepository.getRouteById(pinnedId);
        if (!pinned) {
          throw invalidCommandError({
            safeMessage: "This story's settings are unavailable right now.",
            internalDetail: `Pinned route version ${pinnedId} for capability "${capability}" was not found.`,
            stage: "model.route",
          });
        }
        if (pinned.capability !== capability) {
          throw invalidCommandError({
            safeMessage: "This story's settings are unavailable right now.",
            internalDetail: `Pinned route ${pinnedId} is for capability "${pinned.capability}", not "${capability}".`,
            stage: "model.route",
          });
        }
        return pinned;
      }

      const active = await routeRepository.getActiveRoute(capability);
      if (!active) {
        throw invalidCommandError({
          safeMessage: "This kind of task is not available right now.",
          internalDetail: `No active model route for capability "${capability}".`,
          stage: "model.route",
        });
      }
      return active;
    },
  };
}
