import "server-only";

import { getWorkflowService } from "@/adapters/jobs";
import { createStoryCommands } from "@/application/story-commands";
import { createStoryQueries } from "@/application/story-queries";
import { getDb } from "@/db/client";
import { createCharacterRepository } from "@/db/repositories/character-repository";
import { createFamilyRepository } from "@/db/repositories/family-repository";
import { createStoryRepository } from "@/db/repositories/story-repository";

/**
 * Server-only composition root for the story surfaces (create flow, reader,
 * library, home, parent settings). Wires the application command/query services
 * to the Drizzle repositories over the process database — the same "build the
 * repository from `getDb()`" pattern the character and workflow roots use. The
 * command service also depends on the shared workflow service so `createOneOffStory`
 * can start the durable pipeline.
 */
export async function getStoryServices() {
  const db = await getDb();
  const deps = {
    familyRepository: createFamilyRepository(db),
    storyRepository: createStoryRepository(db),
    characterRepository: createCharacterRepository(db),
  };
  const workflowService = await getWorkflowService();
  return {
    commands: createStoryCommands({ ...deps, workflowService }),
    queries: createStoryQueries(deps),
  };
}
