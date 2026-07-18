import "server-only";

import path from "node:path";

import type { ObjectStorage } from "@/application/ports/object-storage";
import { getEnv, isDevLikeEnv } from "@/lib/env";
import { createFilesystemObjectStorage } from "./filesystem-object-storage";

/**
 * Private object-storage selection — the single entry point app code uses to get
 * "the" store. Selection MIRRORS the DB client's driver choice
 * (`src/db/client.ts`):
 *
 *  - `BLOB_READ_WRITE_TOKEN` set → Vercel Blob (private). The real path for
 *    preview and production. Imported dynamically so `@vercel/blob` stays out of
 *    bundles when the filesystem adapter is used.
 *  - no token, explicit dev/test → the filesystem adapter (root `.storage/`), a
 *    dev/test convenience so everything runs offline with zero setup.
 *  - no token, production → hard error (never silently boot without storage).
 *
 * Access is LAZY + memoised so importing this module never touches the SDK or the
 * filesystem, keeping `pnpm build`/CI (no env) safe.
 */

const DEV_STORAGE_DIR = path.join(process.cwd(), ".storage");

let cached: Promise<ObjectStorage> | undefined;

async function create(): Promise<ObjectStorage> {
  const env = getEnv();

  if (env.BLOB_READ_WRITE_TOKEN) {
    const { createVercelBlobObjectStorage } =
      await import("./vercel-blob-object-storage");
    return createVercelBlobObjectStorage();
  }

  if (!isDevLikeEnv(env)) {
    throw new Error(
      "BLOB_READ_WRITE_TOKEN is required outside explicit development/test. Refusing to fall back to the dev filesystem object store.",
    );
  }

  return createFilesystemObjectStorage(DEV_STORAGE_DIR);
}

/** Lazily build (and memoise) the object store for the current process. */
export function getObjectStorage(): Promise<ObjectStorage> {
  cached ??= create();
  return cached;
}
