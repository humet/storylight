import "server-only";

import { createIllustrationService } from "@/application/illustration-service";
import { getObjectStorage } from "@/adapters/storage/object-storage";
import { getDb } from "@/db/client";
import { createFamilyRepository } from "@/db/repositories/family-repository";
import { createIllustrationRepository } from "@/db/repositories/illustration-repository";

/**
 * Server-only composition root for chapter-illustration delivery (mirrors the
 * character visual-service root). Builds the delivery service from `getDb()` +
 * `getObjectStorage()`.
 */
export async function getIllustrationService() {
  const db = await getDb();
  return createIllustrationService({
    familyRepository: createFamilyRepository(db),
    illustrationRepository: createIllustrationRepository(db),
    objectStorage: await getObjectStorage(),
  });
}
