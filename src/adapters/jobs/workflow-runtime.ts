import "server-only";

import { createVisualCharacterService } from "@/application/visual-character-service";
import {
  createWorkflowEngine,
  type WorkflowEngine,
} from "@/application/workflow-engine";
import { createWorkflowRegistry } from "@/application/workflow-registry";
import type { WorkflowRegistry } from "@/application/workflow-engine";
import type { WorkflowRepository } from "@/application/ports/workflow-repository";
import type { FamilyRepository } from "@/application/ports/family-repository";
import { createStructuredGenerator } from "@/application/ai/generate-structured";
import { createModelRegistry } from "@/application/model-routes/model-registry";
import { createModelPricing } from "@/application/model-routes/pricing";
import { getImageModel } from "@/adapters/images";
import { getLanguageModel } from "@/adapters/ai";
import { getObjectStorage } from "@/adapters/storage/object-storage";
import { getDb } from "@/db/client";
import { createCharacterRepository } from "@/db/repositories/character-repository";
import { createFamilyRepository } from "@/db/repositories/family-repository";
import { createGenerationRunRepository } from "@/db/repositories/generation-run-repository";
import { createModelRouteRepository } from "@/db/repositories/model-route-repository";
import { createSeriesRepository } from "@/db/repositories/series-repository";
import { createStoryRepository } from "@/db/repositories/story-repository";
import { createVisualAssetRepository } from "@/db/repositories/visual-asset-repository";
import { createWorkflowRepository } from "@/db/repositories/workflow-repository";

/**
 * Server-only composition of the workflow RUNTIME — the engine, its repository,
 * the registry, and the family repository the service authorises through. This is
 * the shared wiring both dispatchers use: the in-process dev/test dispatcher and
 * the WDK step (which rebuilds the runtime inside a durable step). It follows the
 * established "build from `getDb()`" pattern (`visual-service.ts`).
 *
 * The runtime is a plain factory (NOT memoised here); `dispatcher.ts` memoises
 * one instance per process so background drives share it.
 */
export interface WorkflowRuntime {
  engine: WorkflowEngine;
  workflowRepository: WorkflowRepository;
  familyRepository: FamilyRepository;
  registry: WorkflowRegistry;
}

export async function createWorkflowRuntime(): Promise<WorkflowRuntime> {
  const db = await getDb();
  const familyRepository = createFamilyRepository(db);
  const workflowRepository = createWorkflowRepository(db);
  const characterRepository = createCharacterRepository(db);
  const storyRepository = createStoryRepository(db);

  const visualCharacterService = createVisualCharacterService({
    familyRepository,
    characterRepository,
    visualAssetRepository: createVisualAssetRepository(db),
    objectStorage: await getObjectStorage(),
    imageModel: getImageModel(),
  });

  // M6 structured-generation stack (capability routing → pipeline → run records).
  const modelRouteRepository = createModelRouteRepository(db);
  const modelRegistry = createModelRegistry(modelRouteRepository);
  const structuredGenerator = createStructuredGenerator({
    modelRegistry,
    languageModel: getLanguageModel(),
    pricing: createModelPricing(),
  });
  const generationRunRepository = createGenerationRunRepository(db);
  const seriesRepository = createSeriesRepository(db);

  const registry = createWorkflowRegistry({
    visualCharacterService,
    structuredGenerator,
    generationRunRepository,
    storyRepository,
    characterRepository,
    seriesRepository,
    modelRouteRepository,
  });
  const engine = createWorkflowEngine({ repo: workflowRepository, registry });

  return { engine, workflowRepository, familyRepository, registry };
}
