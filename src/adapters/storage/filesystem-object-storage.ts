import "server-only";

import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  ObjectBytes,
  ObjectMetadata,
  ObjectStorage,
  PutObjectInput,
  StoredObject,
} from "@/application/ports/object-storage";

/**
 * Dev/test filesystem {@link ObjectStorage} adapter. Bytes live privately under a
 * root directory (default `.storage/`, gitignored) so the dev server and the test
 * suite run offline with no Vercel Blob token — the same shape by which the DB
 * client falls back to PGlite. NEVER selected in production (the factory throws
 * first when no blob token is present outside dev/test).
 *
 * Each object is two files: the raw bytes at the key path, and a sidecar
 * `<key>.meta.json` carrying the content type + checksum, so {@link read} can
 * honour the port's `{ bytes, contentType }` contract without a database.
 */

interface SidecarMeta {
  contentType: string;
  checksum: string;
  size: number;
}

export function createFilesystemObjectStorage(root: string): ObjectStorage {
  const absoluteRoot = path.resolve(root);

  /** Resolve a key to an absolute path, refusing any escape from the root. */
  function resolve(key: string): string {
    const target = path.resolve(absoluteRoot, key);
    const rel = path.relative(absoluteRoot, target);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(`Refusing object-store path outside root: "${key}".`);
    }
    return target;
  }

  return {
    async put(input: PutObjectInput): Promise<StoredObject> {
      const target = resolve(input.key);
      await mkdir(path.dirname(target), { recursive: true });
      const bytes = Buffer.from(input.bytes);
      await writeFile(target, bytes);
      const meta: SidecarMeta = {
        contentType: input.contentType,
        checksum: input.checksum,
        size: bytes.byteLength,
      };
      await writeFile(`${target}.meta.json`, JSON.stringify(meta), "utf8");
      return { key: input.key, size: bytes.byteLength };
    },

    async read(key: string): Promise<ObjectBytes | null> {
      const target = resolve(key);
      try {
        const [bytes, metaRaw] = await Promise.all([
          readFile(target),
          readFile(`${target}.meta.json`, "utf8"),
        ]);
        const meta = JSON.parse(metaRaw) as SidecarMeta;
        return {
          bytes: new Uint8Array(bytes),
          contentType: meta.contentType,
        };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    async head(key: string): Promise<ObjectMetadata | null> {
      const target = resolve(key);
      try {
        const info = await stat(target);
        return { key, size: info.size };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    async delete(key: string): Promise<void> {
      const target = resolve(key);
      await rm(target, { force: true });
      await rm(`${target}.meta.json`, { force: true });
    },
  };
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}
