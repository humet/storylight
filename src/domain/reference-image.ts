import type { ReferenceView } from "./reference-view";

/**
 * A RESOLVED approved reference image — the raw bytes an image/vision adapter
 * conditions on for character identity (ADR-003, rule 6/7). It is deliberately
 * NOT part of the model-neutral {@link import("./image-request").ImageSceneRequest}
 * (which stays pure/snapshot-tested and carries `assetId`s only): the APPLICATION
 * layer — which owns object storage + the visual-asset repository — resolves each
 * selected `assetId` to its private storage key and reads the bytes, then hands
 * this transport type to the adapter as a SEPARATE argument. The adapter passes
 * the bytes to the provider as image content parts; the model never chooses which
 * references to use.
 *
 * Bytes never touch canonical state, a workflow payload, or Postgres — this type
 * lives only for the duration of a single generate/review call.
 */
export interface ReferenceImage {
  /** The child this reference depicts (absent for non-child references). */
  characterKey?: string;
  /** Which canonical view the reference depicts. */
  view: ReferenceView;
  /** Raw approved-reference bytes (read from private object storage). */
  bytes: Uint8Array;
  /** IANA media type of {@link bytes} (e.g. `image/png`). */
  contentType: string;
}
