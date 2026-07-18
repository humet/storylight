import { generationFailedError } from "@/lib/errors";

/**
 * MIME + decode validation for generated image bytes
 * (`docs/05-backend/storage.md` "Upload pipeline": "MIME and decode
 * validation"). Pure and provider-agnostic — it runs before any private upload
 * so malformed or disallowed bytes never enter the store. A failure throws a
 * client-safe `GENERATION_FAILED` (the provider detail stays server-side).
 */

/** Content types the store will accept (raster derivatives + the fake SVG). */
export const ALLOWED_IMAGE_CONTENT_TYPES = [
  "image/svg+xml",
  "image/png",
  "image/webp",
  "image/avif",
  "image/jpeg",
] as const;

export type AllowedImageContentType =
  (typeof ALLOWED_IMAGE_CONTENT_TYPES)[number];

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, i) => bytes[i] === byte);
}

/** Best-effort magic-byte / structural decode check per content type. */
function decodes(bytes: Uint8Array, contentType: string): boolean {
  switch (contentType) {
    case "image/png":
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]);
    case "image/jpeg":
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case "image/webp":
      // "RIFF" .... "WEBP"
      return (
        startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
        bytes.length >= 12 &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
      );
    case "image/avif":
      // ftyp box with an AVIF-family brand.
      return bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74;
    case "image/svg+xml": {
      const head = new TextDecoder()
        .decode(bytes.subarray(0, 512))
        .toLowerCase();
      return head.includes("<svg");
    }
    default:
      return false;
  }
}

/**
 * Assert that `bytes` are non-empty, of an allowed content type, and structurally
 * decodable for that type. Throws `GENERATION_FAILED` otherwise.
 */
export function assertDecodableImage(
  bytes: Uint8Array,
  contentType: string,
): void {
  const allowed = (ALLOWED_IMAGE_CONTENT_TYPES as readonly string[]).includes(
    contentType,
  );
  if (bytes.length === 0 || !allowed || !decodes(bytes, contentType)) {
    throw generationFailedError({
      internalDetail: `Rejected image: contentType="${contentType}", byteLength=${bytes.length}, decodable=${allowed ? decodes(bytes, contentType) : "n/a"}.`,
      stage: "image.validate",
    });
  }
}
