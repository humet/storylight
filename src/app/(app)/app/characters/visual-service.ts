import "server-only";

import { getImageModel } from "@/adapters/images";
import { getObjectStorage } from "@/adapters/storage/object-storage";
import { createVisualCharacterService } from "@/application/visual-character-service";
import { getDb } from "@/db/client";
import { createCharacterRepository } from "@/db/repositories/character-repository";
import { createFamilyRepository } from "@/db/repositories/family-repository";
import { createVisualAssetRepository } from "@/db/repositories/visual-asset-repository";

/**
 * Server-only composition root for the visual-character flow. Wires the
 * application service to the real repositories, the selected private object
 * store, and the image-model adapter (the deterministic fake in M4) — the same
 * "build from `getDb()`" pattern as `service.ts`. Pages, Server Actions, and the
 * delivery routes depend on this, never on Drizzle or a provider SDK directly.
 */
export async function getVisualCharacterService() {
  const db = await getDb();
  const objectStorage = await getObjectStorage();
  return createVisualCharacterService({
    familyRepository: createFamilyRepository(db),
    characterRepository: createCharacterRepository(db),
    visualAssetRepository: createVisualAssetRepository(db),
    objectStorage,
    imageModel: getImageModel(),
  });
}
