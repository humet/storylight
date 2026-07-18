import type {
  CharacterProfile,
  CharacterProfilePayload,
  CharacterRelationship,
  CharacterStatus,
  CharacterSummary,
} from "@/domain/character";

/**
 * Character repository PORT — owned by the application layer so policy never
 * depends on Drizzle. The Drizzle implementation lives in
 * `src/db/repositories/character-repository.ts`; tests can supply a fake.
 *
 * FAMILY SCOPING: every method takes the `familyId` the caller has ALREADY been
 * authorised for (via `authorizeFamilyAction`, which proves membership) and
 * filters every read and write by it. A character id alone is never trusted — a
 * character that belongs to another family is invisible here, so it cannot be
 * read, versioned, or transitioned across the family boundary
 * (`docs/05-backend/auth.md`).
 *
 * VERSIONING: `createCharacter` captures version 1; `addVersion` mints the next
 * immutable version for a PERMANENT change and repoints the character at it.
 * Lifecycle changes (`setStatus`) never mint a version.
 */
export interface CharacterRepository {
  /** Create a draft character and its version-1 profile snapshot atomically. */
  createCharacter(input: {
    familyId: string;
    characterKey: string;
    payload: CharacterProfilePayload;
  }): Promise<CharacterProfile>;

  /** The full profile (character + current version), or null if not in family. */
  getCharacter(
    familyId: string,
    characterId: string,
  ): Promise<CharacterProfile | null>;

  /** Compact summaries for the family's character grid. */
  listCharacters(familyId: string): Promise<CharacterSummary[]>;

  /**
   * Apply a PERMANENT change: append a new version snapshot and repoint the
   * character at it. Returns the updated profile, or null if the character is
   * not in the family.
   */
  addVersion(input: {
    familyId: string;
    characterId: string;
    payload: CharacterProfilePayload;
  }): Promise<CharacterProfile | null>;

  /**
   * Set the lifecycle status (approve/retire). `approvedAt` is stamped on the
   * first approval. Returns the updated profile, or null if not in the family.
   */
  setStatus(input: {
    familyId: string;
    characterId: string;
    status: CharacterStatus;
    approvedAt?: Date;
  }): Promise<CharacterProfile | null>;

  /** Record a relationship between two characters that both belong to family. */
  createRelationship(input: {
    familyId: string;
    relationship: CharacterRelationship;
  }): Promise<CharacterRelationship | null>;

  /** Every relationship within the family. */
  listRelationships(familyId: string): Promise<CharacterRelationship[]>;
}
