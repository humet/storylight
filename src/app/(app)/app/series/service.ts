import "server-only";

import { getWorkflowService } from "@/adapters/jobs";
import { createSeriesCommands } from "@/application/series-commands";
import { createSeriesQueries } from "@/application/series-queries";
import { getDb } from "@/db/client";
import { createCharacterRepository } from "@/db/repositories/character-repository";
import { createFamilyRepository } from "@/db/repositories/family-repository";
import { createSeriesRepository } from "@/db/repositories/series-repository";
import { createStoryRepository } from "@/db/repositories/story-repository";

/**
 * Server-only composition root for the SERIES surfaces (create flow series option,
 * series overview, chapter reader, "Continue tonight"). Wires the application
 * command/query services to the Drizzle repositories over the process database —
 * the same "build the repository from `getDb()`" pattern the story root uses.
 */
export async function getSeriesServices() {
  const db = await getDb();
  const familyRepository = createFamilyRepository(db);
  const storyRepository = createStoryRepository(db);
  const seriesRepository = createSeriesRepository(db);
  const characterRepository = createCharacterRepository(db);
  const workflowService = await getWorkflowService();
  return {
    commands: createSeriesCommands({
      familyRepository,
      storyRepository,
      seriesRepository,
      characterRepository,
      workflowService,
    }),
    queries: createSeriesQueries({ familyRepository, seriesRepository }),
  };
}
