import type { AuthenticatedActor } from "@/domain/actor";
import type { CharacterProfile, CharacterSummary } from "@/domain/character";
import { unauthorisedError } from "@/lib/errors";
import { authorizeFamilyAction } from "./family-access";
import type { CharacterRepository } from "./ports/character-repository";
import type { FamilyRepository } from "./ports/family-repository";

/**
 * Character query service (`docs/05-backend/api.md` "Queries"). Reads are
 * authorised the same way as writes — membership + `character:manage` on the
 * actor's family — and return purpose-built read models (compact summaries for
 * the grid, the full profile for the editor). The profile contains only the
 * parent's own authored data: no prompts, hidden plans, or provider metadata.
 */

export interface CharacterQueryDeps {
  familyRepository: FamilyRepository;
  characterRepository: CharacterRepository;
}

function requirePrimaryFamily(actor: AuthenticatedActor): string {
  const familyId = actor.familyIds[0];
  if (!familyId) {
    throw unauthorisedError({
      internalDetail: `Actor ${actor.userId} has no family to read.`,
      stage: "character.family",
    });
  }
  return familyId;
}

export function createCharacterQueries(deps: CharacterQueryDeps) {
  const { familyRepository, characterRepository } = deps;

  async function authorise(actor: AuthenticatedActor): Promise<string> {
    const familyId = requirePrimaryFamily(actor);
    await authorizeFamilyAction(familyRepository, {
      userId: actor.userId,
      familyId,
      capability: "character:manage",
    });
    return familyId;
  }

  return {
    /** The family's characters as compact grid summaries. */
    async getCharacterProfiles(
      actor: AuthenticatedActor,
    ): Promise<CharacterSummary[]> {
      const familyId = await authorise(actor);
      const summaries = await characterRepository.listCharacters(familyId);
      // Newest first is the calmest default for a small family grid.
      return summaries.sort((a, b) =>
        a.displayName.localeCompare(b.displayName),
      );
    },

    /** A single full profile for the editor/review surface, or null. */
    async getCharacterProfile(
      actor: AuthenticatedActor,
      characterId: string,
    ): Promise<CharacterProfile | null> {
      const familyId = await authorise(actor);
      return characterRepository.getCharacter(familyId, characterId);
    },
  };
}

export type CharacterQueries = ReturnType<typeof createCharacterQueries>;
