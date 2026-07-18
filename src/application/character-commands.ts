import type { AuthenticatedActor } from "@/domain/actor";
import { buildCharacterKey } from "@/domain/character-key";
import { applyCharacterStatusTransition } from "@/domain/character-status";
import type { CharacterProfile } from "@/domain/character";
import { invalidCommandError, unauthorisedError } from "@/lib/errors";
import { authorizeFamilyAction } from "./family-access";
import {
  CharacterIdCommandSchema,
  CreateCharacterProfileCommandSchema,
  UpdateCharacterProfileCommandSchema,
} from "./character-schemas";
import type { CharacterRepository } from "./ports/character-repository";
import type { FamilyRepository } from "./ports/family-repository";

/**
 * Character command service (`docs/05-backend/api.md`). Every mutation:
 *
 *  1. resolves the actor's family, then AUTHORISES with `character:manage` via
 *     `authorizeFamilyAction` (membership + capability) — never trusting an id;
 *  2. parses input with the Zod v4 command schema at the boundary;
 *  3. runs the repository, which is itself family-scoped.
 *
 * Server Actions stay thin wrappers around these (`docs/05-backend/api.md`
 * "Server Actions"). Nothing here imports a provider SDK or Drizzle.
 */

export interface CharacterCommandDeps {
  familyRepository: FamilyRepository;
  characterRepository: CharacterRepository;
}

/**
 * MVP is single-family: a character command acts in the actor's primary family.
 * (Multi-family selection is a later concern; `authorizeFamilyAction` still
 * verifies membership + capability for whichever family we resolve.)
 */
function requirePrimaryFamily(actor: AuthenticatedActor): string {
  const familyId = actor.familyIds[0];
  if (!familyId) {
    throw unauthorisedError({
      internalDetail: `Actor ${actor.userId} has no family to act in.`,
      stage: "character.family",
    });
  }
  return familyId;
}

/** Short random suffix for a semantic character key (app-generated, not a model). */
function randomKeySuffix(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}

export function createCharacterCommands(deps: CharacterCommandDeps) {
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
    /** Create a draft character (version 1). Returns the new profile. */
    async createCharacterProfile(
      actor: AuthenticatedActor,
      input: unknown,
    ): Promise<CharacterProfile> {
      const familyId = await authorise(actor);
      const payload = CreateCharacterProfileCommandSchema.parse(input);
      const characterKey = buildCharacterKey(
        payload.displayName,
        randomKeySuffix(),
      );
      return characterRepository.createCharacter({
        familyId,
        characterKey,
        payload,
      });
    },

    /** Apply a PERMANENT change — mints a new version. Returns the profile. */
    async updateCharacterProfile(
      actor: AuthenticatedActor,
      input: unknown,
    ): Promise<CharacterProfile> {
      const familyId = await authorise(actor);
      const { characterId, payload } =
        UpdateCharacterProfileCommandSchema.parse(input);
      const updated = await characterRepository.addVersion({
        familyId,
        characterId,
        payload,
      });
      if (!updated) {
        throw invalidCommandError({
          safeMessage: "That character could not be found.",
          internalDetail: `Character ${characterId} not in family ${familyId}.`,
          stage: "character.update",
        });
      }
      return updated;
    },

    /** Approve a draft (draft → active), stamping the approval time. */
    async approveCharacterProfile(
      actor: AuthenticatedActor,
      input: unknown,
    ): Promise<CharacterProfile> {
      const familyId = await authorise(actor);
      const { characterId } = CharacterIdCommandSchema.parse(input);
      const current = await characterRepository.getCharacter(
        familyId,
        characterId,
      );
      if (!current) {
        throw invalidCommandError({
          safeMessage: "That character could not be found.",
          internalDetail: `Character ${characterId} not in family ${familyId}.`,
          stage: "character.approve",
        });
      }
      const status = applyCharacterStatusTransition(current.status, "approve");
      const updated = await characterRepository.setStatus({
        familyId,
        characterId,
        status,
        approvedAt: current.approvedAt ?? new Date(),
      });
      // The membership + existence were just checked; a null here is a bug.
      if (!updated) {
        throw invalidCommandError({
          safeMessage: "That character could not be found.",
          internalDetail: `Character ${characterId} vanished during approval.`,
          stage: "character.approve",
        });
      }
      return updated;
    },

    /** Retire an active character (active → retired). */
    async retireCharacterProfile(
      actor: AuthenticatedActor,
      input: unknown,
    ): Promise<CharacterProfile> {
      const familyId = await authorise(actor);
      const { characterId } = CharacterIdCommandSchema.parse(input);
      const current = await characterRepository.getCharacter(
        familyId,
        characterId,
      );
      if (!current) {
        throw invalidCommandError({
          safeMessage: "That character could not be found.",
          internalDetail: `Character ${characterId} not in family ${familyId}.`,
          stage: "character.retire",
        });
      }
      const status = applyCharacterStatusTransition(current.status, "retire");
      const updated = await characterRepository.setStatus({
        familyId,
        characterId,
        status,
      });
      if (!updated) {
        throw invalidCommandError({
          safeMessage: "That character could not be found.",
          internalDetail: `Character ${characterId} vanished during retirement.`,
          stage: "character.retire",
        });
      }
      return updated;
    },
  };
}

export type CharacterCommands = ReturnType<typeof createCharacterCommands>;
