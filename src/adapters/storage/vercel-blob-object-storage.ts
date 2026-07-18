import "server-only";

import { del, get, head, put } from "@vercel/blob";

import type {
  ObjectBytes,
  ObjectMetadata,
  ObjectStorage,
  PutObjectInput,
  StoredObject,
} from "@/application/ports/object-storage";

/**
 * Vercel Blob {@link ObjectStorage} adapter (private objects) for deployed
 * environments (ADR-006). `@vercel/blob` is imported ONLY here (ESLint-enforced,
 * domain rule 12). It is CONTRACT-TYPED against the SDK but not live-tested in
 * this environment — there is no `BLOB_READ_WRITE_TOKEN` here, so the filesystem
 * adapter backs every test. The token is read by the SDK from the environment.
 *
 * Everything is `access: "private"`: objects are never publicly reachable, and
 * the pathname (our key scheme) is used verbatim (`addRandomSuffix: false`) so a
 * key maps to exactly one object. Delivery streams the bytes back through the
 * authorized route via {@link ObjectStorage.read}; no permanent URL is stored.
 */
export function createVercelBlobObjectStorage(): ObjectStorage {
  return {
    async put(input: PutObjectInput): Promise<StoredObject> {
      const result = await put(input.key, Buffer.from(input.bytes), {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: input.contentType,
      });
      return { key: result.pathname, size: input.bytes.byteLength };
    },

    async read(key: string): Promise<ObjectBytes | null> {
      const result = await get(key, { access: "private" });
      if (!result || result.statusCode !== 200) return null;
      const buffer = await streamToBuffer(result.stream);
      return {
        bytes: new Uint8Array(buffer),
        contentType: result.blob.contentType,
      };
    },

    async head(key: string): Promise<ObjectMetadata | null> {
      try {
        const result = await head(key);
        return { key: result.pathname, size: result.size };
      } catch {
        // `head` throws BlobNotFoundError for a missing object.
        return null;
      }
    },

    async delete(key: string): Promise<void> {
      await del(key);
    },
  };
}

async function streamToBuffer(
  stream: ReadableStream<Uint8Array>,
): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks);
}
