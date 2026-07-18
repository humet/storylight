import { generationFailedError } from "@/lib/errors";
import { assertDecodableImage } from "./image-validation";
import type { IllustrationAspect } from "./image-request";

/**
 * TECHNICAL validation of a generated scene image
 * (`docs/03-ai/image-generation.md` "Technical validation": decode,
 * dimensions/ratio, size), run BEFORE the quarantined upload. It composes the M4
 * decode/MIME check with dimension, aspect-ratio and size bounds so a malformed or
 * wrongly-shaped render never enters storage. Pure and provider-agnostic; a
 * failure throws a client-safe `GENERATION_FAILED` (provider detail stays server
 * side).
 */

/** Expected aspect ratio (width / height) per illustration aspect. */
const ASPECT_RATIO: Record<IllustrationAspect, number> = {
  portrait: 3 / 4,
  landscape: 4 / 3,
  square: 1,
};

/** A generous cap on a single original (2K PNG). Guards against runaway bytes. */
export const MAX_ORIGINAL_BYTES = 12 * 1024 * 1024;

/** Minimum long edge — a 2K routine image must not be a thumbnail. */
export const MIN_LONG_EDGE = 512;

export interface TechnicalImage {
  bytes: Uint8Array;
  contentType: string;
  width: number;
  height: number;
}

/**
 * Assert a scene image is decodable, within size bounds, non-degenerate, and
 * within ±8% of the expected aspect ratio. Throws `GENERATION_FAILED` otherwise.
 */
export function assertTechnicalImage(
  image: TechnicalImage,
  expectedAspect: IllustrationAspect,
): void {
  assertDecodableImage(image.bytes, image.contentType);

  if (image.bytes.byteLength > MAX_ORIGINAL_BYTES) {
    throw generationFailedError({
      internalDetail: `Scene image too large: ${image.bytes.byteLength} bytes (max ${MAX_ORIGINAL_BYTES}).`,
      stage: "image.technical",
    });
  }

  if (
    !Number.isInteger(image.width) ||
    !Number.isInteger(image.height) ||
    image.width <= 0 ||
    image.height <= 0
  ) {
    throw generationFailedError({
      internalDetail: `Scene image has invalid dimensions ${image.width}x${image.height}.`,
      stage: "image.technical",
    });
  }

  const longEdge = Math.max(image.width, image.height);
  if (longEdge < MIN_LONG_EDGE) {
    throw generationFailedError({
      internalDetail: `Scene image long edge ${longEdge}px below the ${MIN_LONG_EDGE}px minimum.`,
      stage: "image.technical",
    });
  }

  const expected = ASPECT_RATIO[expectedAspect];
  const actual = image.width / image.height;
  const drift = Math.abs(actual - expected) / expected;
  if (drift > 0.08) {
    throw generationFailedError({
      internalDetail: `Scene image aspect ${actual.toFixed(3)} drifts ${(drift * 100).toFixed(1)}% from expected ${expected.toFixed(3)} (${expectedAspect}).`,
      stage: "image.technical",
    });
  }
}
