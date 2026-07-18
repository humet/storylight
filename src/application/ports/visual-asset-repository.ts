import type { ReferenceView } from "@/domain/reference-view";
import type {
  CandidateSet,
  ReferenceAsset,
  VisualAsset,
  VisualAssetState,
  VisualProfile,
} from "@/domain/visual-asset";

/**
 * Visual-asset repository PORT — owned by the application layer so policy never
 * depends on Drizzle. The Drizzle implementation lives in
 * `src/db/repositories/visual-asset-repository.ts`; tests supply a fake or run
 * the real repo against PGlite.
 *
 * FAMILY + CHARACTER SCOPING: every method takes the `familyId` the caller has
 * already been authorised for AND the `characterId`, and filters every read and
 * write by both. A guessed asset/candidate id from another family (or another
 * character) resolves to nothing — it cannot be read, approved, or delivered.
 *
 * STATE INTEGRITY: `recordCandidateSet` always records `quarantined` assets;
 * `approveCandidateSet` performs the whole approval atomically (approve the
 * chosen set, reject its siblings, mint the next immutable visual-profile
 * version, link the ordered reference assets, and repoint the character). Only
 * `approved` assets are ever returned by {@link getApprovedReferenceSet}.
 */

/** A quarantined asset to record (bytes are already uploaded to storage). */
export interface NewVisualAsset {
  id: string;
  view: ReferenceView;
  storageKey: string;
  contentType: string;
  checksum: string;
  byteSize: number;
  width: number;
  height: number;
  model: string;
  seed: number;
}

export interface RecordCandidateSetInput {
  familyId: string;
  characterId: string;
  candidateSetId: string;
  assets: NewVisualAsset[];
}

export interface ApproveCandidateSetInput {
  familyId: string;
  characterId: string;
  candidateSetId: string;
  artBibleVersion: string;
  /** Approved assets in canonical reference order (position assigned by caller). */
  orderedAssets: Array<{
    assetId: string;
    view: ReferenceView;
    position: number;
  }>;
}

export interface VisualAssetRepository {
  /**
   * The character's latest visual-profile version number, or 0 when it has none.
   * Used to compute the PROSPECTIVE version for a candidate's storage key at
   * generation time (the eventual approved version is assigned atomically in
   * {@link approveCandidateSet}).
   */
  getLatestVisualProfileVersion(
    familyId: string,
    characterId: string,
  ): Promise<number>;

  /** Record a freshly-generated, quarantined candidate set. */
  recordCandidateSet(input: RecordCandidateSetInput): Promise<CandidateSet>;

  /** Candidate sets for a character in a given state (e.g. `quarantined`). */
  listCandidateSetsByState(
    familyId: string,
    characterId: string,
    state: VisualAssetState,
  ): Promise<CandidateSet[]>;

  /**
   * A single asset scoped to family + character, in ANY state, or null. The
   * delivery service uses this and then enforces the state filter itself, so the
   * `storageKey` never leaves the server.
   */
  getAsset(
    familyId: string,
    characterId: string,
    assetId: string,
  ): Promise<VisualAsset | null>;

  /**
   * Approve a quarantined candidate set atomically: mark its assets approved,
   * reject the character's OTHER quarantined sets, mint the next immutable visual
   * profile version, link the ordered reference assets, and repoint
   * `child_characters.visual_profile_id`. Returns the new profile, or null if the
   * set is not a quarantined set of this character in this family.
   */
  approveCandidateSet(
    input: ApproveCandidateSetInput,
  ): Promise<VisualProfile | null>;

  /**
   * Reject a quarantined candidate set (mark its assets rejected). Returns true
   * when a quarantined set was found and rejected, false otherwise.
   */
  rejectCandidateSet(input: {
    familyId: string;
    characterId: string;
    candidateSetId: string;
  }): Promise<boolean>;

  /**
   * The id of the character's CURRENT visual profile
   * (`child_characters.visual_profile_id`), or null when it has no approved
   * profile. Used by delivery to reject a superseded (retired) asset id even if a
   * retire transition were ever missed — defence in depth.
   */
  getCurrentVisualProfileId(
    familyId: string,
    characterId: string,
  ): Promise<string | null>;

  /**
   * The character's CURRENT approved reference set (the assets linked to the
   * visual profile version `child_characters.visual_profile_id` points at),
   * ordered by position. Empty when the character has no approved profile.
   */
  getApprovedReferenceSet(
    familyId: string,
    characterId: string,
  ): Promise<ReferenceAsset[]>;
}
