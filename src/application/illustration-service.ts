import type { AuthenticatedActor } from "@/domain/actor";
import { unauthorisedError } from "@/lib/errors";
import { authorizeFamilyAction } from "./family-access";
import type { FamilyRepository } from "./ports/family-repository";
import type { IllustrationRepository } from "./ports/illustration-repository";
import type { ObjectStorage } from "./ports/object-storage";

/**
 * Chapter-illustration DELIVERY service (`docs/04-frontend/story-reader.md`
 * "Illustration behaviour": never show quarantined or rejected images; use
 * responsive derivatives; allow fullscreen). Mirrors the M4 character-asset
 * delivery: it AUTHORISES `story:read` on the actor's family, then resolves the
 * best APPROVED derivative for a spec — the state filter lives in the repository
 * (`getDeliverable` returns null unless the publication AND the asset are
 * `approved`), so rejected/quarantined/retired originals are unreachable from every
 * path (rule 9). The storage key never leaves the server.
 */

export interface IllustrationServiceDeps {
  familyRepository: FamilyRepository;
  illustrationRepository: IllustrationRepository;
  objectStorage: ObjectStorage;
}

export interface DeliveredIllustration {
  bytes: Uint8Array;
  contentType: string;
}

function requirePrimaryFamily(actor: AuthenticatedActor): string {
  const familyId = actor.familyIds[0];
  if (!familyId) {
    throw unauthorisedError({
      internalDetail: `Actor ${actor.userId} has no family to read.`,
      stage: "illustration.family",
    });
  }
  return familyId;
}

export function createIllustrationService(deps: IllustrationServiceDeps) {
  const { familyRepository, illustrationRepository, objectStorage } = deps;

  return {
    /**
     * Resolve the deliverable bytes for an APPROVED illustration spec (best
     * derivative ≤ `maxWidth`, else the original). Returns null for anything the
     * actor may not see, so the route answers a uniform 404 — rejected/pending
     * images never leak.
     */
    async resolveDeliverableIllustration(
      actor: AuthenticatedActor,
      specId: string,
      maxWidth?: number,
    ): Promise<DeliveredIllustration | null> {
      const familyId = requirePrimaryFamily(actor);
      await authorizeFamilyAction(familyRepository, {
        userId: actor.userId,
        familyId,
        capability: "story:read",
      });
      const deliverable = await illustrationRepository.getDeliverable(
        familyId,
        specId,
        maxWidth,
      );
      if (!deliverable) return null;
      const object = await objectStorage.read(deliverable.storageKey);
      if (!object) return null;
      return { bytes: object.bytes, contentType: deliverable.contentType };
    },
  };
}

export type IllustrationService = ReturnType<typeof createIllustrationService>;
