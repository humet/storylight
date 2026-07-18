/**
 * Visual character-identity domain types (`docs/03-ai/image-generation.md`,
 * `docs/05-backend/storage.md`, ADR-003). These are pure domain shapes,
 * independent of Drizzle row types and of any image provider (AGENTS.md).
 *
 * A character's visual identity is a VERSIONED, APPROVED reference set: parents
 * request candidate sets, review them, and approve exactly one. Approval mints a
 * new immutable {@link VisualProfile} version and links its approved
 * {@link VisualAsset}s. Rejected/quarantined assets never reach reader delivery.
 */

/** The pinned Art Bible version for the MVP's single approved style. */
export const ART_BIBLE_VERSION = "mvp-gouache-v1";

/**
 * Lifecycle state of a stored image asset (`docs/05-backend/storage.md`
 * "Asset states"). Only `approved` assets can receive reader delivery URLs.
 */
export type VisualAssetState =
  "quarantined" | "approved" | "rejected" | "retired" | "deletion-pending";

import type { ReferenceView } from "./reference-view";

/**
 * A single stored image asset. `storageKey` is the private object-store key and
 * is NEVER exposed to clients (`docs/05-backend/storage.md` "Do not expose raw
 * keys"). Image BYTES live only in object storage, never in Postgres (AGENTS.md).
 */
export interface VisualAsset {
  id: string;
  familyId: string;
  characterId: string;
  /** Groups the assets generated together in one candidate set. */
  candidateSetId: string;
  view: ReferenceView;
  state: VisualAssetState;
  /** Private object-store key — internal only, never serialized to a client. */
  storageKey: string;
  contentType: string;
  /** SHA-256 of the stored bytes, for integrity verification. */
  checksum: string;
  byteSize: number;
  width: number;
  height: number;
  /** Opaque model identifier for lineage (e.g. "fake-placeholder@1"). */
  model: string;
  seed: number;
  /** Set when the asset is approved into a visual profile version. */
  visualProfileId: string | null;
  createdAt: Date;
  reviewedAt?: Date;
}

/**
 * A client-safe summary of a candidate asset — enough to render and act on it in
 * the approval UI, with NO storage key or provider internals.
 */
export interface CandidateAssetSummary {
  id: string;
  view: ReferenceView;
  state: VisualAssetState;
}

/** A group of candidate assets generated together, pending parent review. */
export interface CandidateSet {
  id: string;
  characterId: string;
  createdAt: Date;
  assets: CandidateAssetSummary[];
}

/**
 * An immutable approved visual-identity version for a character. Advancing to a
 * new version (re-approving a fresh candidate set) never mutates an existing
 * one — visual profiles are immutable revisions (domain rule 5).
 */
export interface VisualProfile {
  id: string;
  familyId: string;
  characterId: string;
  version: number;
  artBibleVersion: string;
  createdAt: Date;
  approvedAt: Date;
}

/**
 * A client-safe descriptor of one asset in an approved reference set: enough to
 * render (via the authorized delivery route, by id) and to order, with no key.
 */
export interface ReferenceAsset {
  id: string;
  view: ReferenceView;
  position: number;
}
