import { and, eq } from "drizzle-orm";

import type { CharacterRepository } from "@/application/ports/character-repository";
import type {
  CharacterProfile,
  CharacterRelationship,
  CharacterSummary,
} from "@/domain/character";
import type { Database } from "../client";
import {
  characterProfileVersions,
  characterRelationships,
  childCharacters,
} from "../schema";

/**
 * Drizzle implementation of {@link CharacterRepository}. Only this layer knows
 * the table shape; it maps rows to pure domain types so nothing upstream depends
 * on Drizzle (AGENTS.md: "Keep domain types independent of DB row types").
 *
 * Every query is filtered by `family_id`, so a character id that belongs to
 * another family resolves to nothing — cross-family reads and writes are
 * impossible even with a guessed id.
 */

type CharacterRow = typeof childCharacters.$inferSelect;
type VersionRow = typeof characterProfileVersions.$inferSelect;
type RelationshipRow = typeof characterRelationships.$inferSelect;

function toProfile(
  character: CharacterRow,
  version: VersionRow,
): CharacterProfile {
  return {
    id: character.id,
    familyId: character.familyId,
    key: character.characterKey,
    displayName: version.displayName,
    apparentAge: version.apparentAge,
    pronouns: version.pronouns,
    appearanceNotes: version.appearanceNotes ?? null,
    status: character.status,
    narrativeIdentity: version.narrativeIdentity,
    fictionalisationPolicy: version.fictionalisationPolicy,
    // The approved visual profile is a lifecycle pointer on the character
    // identity row (M4), not part of an immutable narrative version. The M3
    // `character_profile_versions.visual_profile_id` column is retained but no
    // longer authoritative (BUILD_STATE deviation).
    visualProfileId: character.visualProfileId,
    version: version.version,
    createdAt: character.createdAt,
    approvedAt: character.approvedAt ?? undefined,
  };
}

function toRelationship(row: RelationshipRow): CharacterRelationship {
  return {
    fromCharacterId: row.fromCharacterId,
    toCharacterId: row.toCharacterId,
    type: row.type,
    baseline: row.baseline,
    currentState: row.currentState ?? undefined,
    boundaries: row.boundaries,
  };
}

/** Load a character row scoped to its family. */
async function findCharacterRow(
  db: Database,
  familyId: string,
  characterId: string,
): Promise<CharacterRow | null> {
  const [row] = await db
    .select()
    .from(childCharacters)
    .where(
      and(
        eq(childCharacters.id, characterId),
        eq(childCharacters.familyId, familyId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Load a specific version row scoped to its family. */
async function findVersionRow(
  db: Database,
  familyId: string,
  characterId: string,
  version: number,
): Promise<VersionRow | null> {
  const [row] = await db
    .select()
    .from(characterProfileVersions)
    .where(
      and(
        eq(characterProfileVersions.characterId, characterId),
        eq(characterProfileVersions.familyId, familyId),
        eq(characterProfileVersions.version, version),
      ),
    )
    .limit(1);
  return row ?? null;
}

export function createCharacterRepository(db: Database): CharacterRepository {
  async function loadProfile(
    familyId: string,
    characterId: string,
  ): Promise<CharacterProfile | null> {
    const character = await findCharacterRow(db, familyId, characterId);
    if (!character) return null;
    const version = await findVersionRow(
      db,
      familyId,
      characterId,
      character.currentVersion,
    );
    if (!version) return null;
    return toProfile(character, version);
  }

  return {
    async createCharacter({ familyId, characterKey, payload }) {
      return db.transaction(async (tx) => {
        const [character] = await tx
          .insert(childCharacters)
          .values({
            familyId,
            characterKey,
            status: "draft",
            displayName: payload.displayName,
            currentVersion: 1,
          })
          .returning();

        const [version] = await tx
          .insert(characterProfileVersions)
          .values({
            characterId: character.id,
            familyId,
            version: 1,
            displayName: payload.displayName,
            apparentAge: payload.apparentAge,
            pronouns: payload.pronouns,
            appearanceNotes: payload.appearanceNotes,
            narrativeIdentity: payload.narrativeIdentity,
            fictionalisationPolicy: payload.fictionalisationPolicy,
            visualProfileId: payload.visualProfileId,
          })
          .returning();

        await tx
          .update(childCharacters)
          .set({ currentVersionId: version.id })
          .where(eq(childCharacters.id, character.id));

        return toProfile(character, version);
      });
    },

    getCharacter(familyId, characterId) {
      return loadProfile(familyId, characterId);
    },

    async listCharacters(familyId) {
      const rows = await db
        .select({
          character: childCharacters,
          version: characterProfileVersions,
        })
        .from(childCharacters)
        .innerJoin(
          characterProfileVersions,
          eq(childCharacters.currentVersionId, characterProfileVersions.id),
        )
        .where(eq(childCharacters.familyId, familyId));

      return rows.map(({ character, version }): CharacterSummary => {
        return {
          id: character.id,
          key: character.characterKey,
          displayName: character.displayName,
          status: character.status,
          apparentAge: version.apparentAge,
          version: character.currentVersion,
          traitCount: version.narrativeIdentity.personalityTraits.length,
          approvedAt: character.approvedAt ?? undefined,
        };
      });
    },

    async addVersion({ familyId, characterId, payload }) {
      return db.transaction(async (tx) => {
        const [character] = await tx
          .select()
          .from(childCharacters)
          .where(
            and(
              eq(childCharacters.id, characterId),
              eq(childCharacters.familyId, familyId),
            ),
          )
          .for("update")
          .limit(1);
        if (!character) return null;

        const nextVersion = character.currentVersion + 1;
        const [version] = await tx
          .insert(characterProfileVersions)
          .values({
            characterId: character.id,
            familyId,
            version: nextVersion,
            displayName: payload.displayName,
            apparentAge: payload.apparentAge,
            pronouns: payload.pronouns,
            appearanceNotes: payload.appearanceNotes,
            narrativeIdentity: payload.narrativeIdentity,
            fictionalisationPolicy: payload.fictionalisationPolicy,
            visualProfileId: payload.visualProfileId,
          })
          .returning();

        const [updated] = await tx
          .update(childCharacters)
          .set({
            currentVersion: nextVersion,
            currentVersionId: version.id,
            displayName: payload.displayName,
            updatedAt: new Date(),
          })
          .where(eq(childCharacters.id, character.id))
          .returning();

        return toProfile(updated, version);
      });
    },

    async setStatus({ familyId, characterId, status, approvedAt }) {
      const [updated] = await db
        .update(childCharacters)
        .set({
          status,
          updatedAt: new Date(),
          ...(approvedAt ? { approvedAt } : {}),
        })
        .where(
          and(
            eq(childCharacters.id, characterId),
            eq(childCharacters.familyId, familyId),
          ),
        )
        .returning();
      if (!updated) return null;

      const version = await findVersionRow(
        db,
        familyId,
        characterId,
        updated.currentVersion,
      );
      if (!version) return null;
      return toProfile(updated, version);
    },

    async createRelationship({ familyId, relationship }) {
      // Both endpoints must belong to the family — never link across families.
      const [from, to] = await Promise.all([
        findCharacterRow(db, familyId, relationship.fromCharacterId),
        findCharacterRow(db, familyId, relationship.toCharacterId),
      ]);
      if (!from || !to) return null;

      const [row] = await db
        .insert(characterRelationships)
        .values({
          familyId,
          fromCharacterId: relationship.fromCharacterId,
          toCharacterId: relationship.toCharacterId,
          type: relationship.type,
          baseline: relationship.baseline,
          currentState: relationship.currentState ?? null,
          boundaries: relationship.boundaries,
        })
        .returning();
      return toRelationship(row);
    },

    async listRelationships(familyId) {
      const rows = await db
        .select()
        .from(characterRelationships)
        .where(eq(characterRelationships.familyId, familyId));
      return rows.map(toRelationship);
    },
  };
}

/**
 * Convenience factory that resolves the process database first. App code that
 * just needs "the" repository uses this; tests build one against a test database
 * with {@link createCharacterRepository} directly.
 */
export async function getCharacterRepository(): Promise<CharacterRepository> {
  const { getDb } = await import("../client");
  return createCharacterRepository(await getDb());
}
