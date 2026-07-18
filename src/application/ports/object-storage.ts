/**
 * Private object storage PORT (`docs/05-backend/storage.md`, ADR-006). Owned by
 * the application layer so nothing upstream depends on Vercel Blob or the local
 * filesystem. Adapters live in `src/adapters/storage/**` — the ONLY place a
 * storage SDK may be imported (ESLint-enforced).
 *
 * Everything here is PRIVATE-only: objects are uploaded server-side and are
 * never publicly reachable. Delivery is either short-lived signed URLs or
 * authorized streaming through a route handler; a raw key is never handed to a
 * client and a permanent signed URL is never stored (`docs/05-backend/storage.md`).
 */

export interface PutObjectInput {
  /** Full private key (built via `buildVisualAssetKey`), already traversal-safe. */
  key: string;
  bytes: Uint8Array;
  contentType: string;
  /** SHA-256 of `bytes`, for the adapter/record to verify integrity. */
  checksum: string;
}

export interface StoredObject {
  key: string;
  size: number;
}

export interface ObjectBytes {
  bytes: Uint8Array;
  contentType: string;
}

export interface ObjectMetadata {
  key: string;
  size: number;
}

export interface ObjectStorage {
  /** Upload private bytes under `key`. Overwrites are allowed (idempotent keys). */
  put(input: PutObjectInput): Promise<StoredObject>;

  /**
   * Read the private bytes for authorized STREAMING through a route handler.
   * Returns `null` when the object does not exist. Callers MUST authorize the
   * request and confirm the asset is deliverable BEFORE calling this — the store
   * itself has no notion of who may read.
   */
  read(key: string): Promise<ObjectBytes | null>;

  /**
   * A short-lived signed delivery URL, when the adapter supports one (e.g. Vercel
   * Blob). Adapters that cannot sign (the dev filesystem) return `null`, and the
   * caller falls back to authorized streaming via {@link read}. The URL is
   * transient and MUST NOT be persisted (`docs/05-backend/storage.md`).
   */
  createSignedUrl?(
    key: string,
    expiresInSeconds: number,
  ): Promise<string | null>;

  /** Object metadata (size), or `null` when it does not exist. */
  head(key: string): Promise<ObjectMetadata | null>;

  /** Delete the object at `key`. Missing keys are a no-op. */
  delete(key: string): Promise<void>;
}
