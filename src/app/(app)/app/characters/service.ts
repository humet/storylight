import "server-only";

import { createCharacterCommands } from "@/application/character-commands";
import { createCharacterQueries } from "@/application/character-queries";
import { getDb } from "@/db/client";
import { createCharacterRepository } from "@/db/repositories/character-repository";
import { createFamilyRepository } from "@/db/repositories/family-repository";

/**
 * Server-only composition root for the character editor. Wires the application
 * command/query services to the real Drizzle repositories over the process
 * database — the same "build the repository from `getDb()`" pattern the auth
 * adapter uses (`src/adapters/auth/require-actor.ts`). Pages and Server Actions
 * depend on this, never on Drizzle directly.
 */
export async function getCharacterServices() {
  const db = await getDb();
  const deps = {
    familyRepository: createFamilyRepository(db),
    characterRepository: createCharacterRepository(db),
  };
  return {
    commands: createCharacterCommands(deps),
    queries: createCharacterQueries(deps),
  };
}
