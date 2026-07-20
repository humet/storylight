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
import { createImageRouteRegistry } from "@/application/model-routes/image-route-registry";
import type { JobDispatcher } from "@/application/ports/job-dispatcher";
import type { IllustrationJobStarter } from "@/application/ports/illustration-job-starter";
import { GENERATE_ILLUSTRATION_TYPE } from "@/application/workflows/generate-illustration-workflow";
import {
  getChapterImageModel,
  getImageModel,
  getVisionModel,
} from "@/adapters/images";
import { getLanguageModel } from "@/adapters/ai";
import { getObjectStorage } from "@/adapters/storage/object-storage";
import { getDb } from "@/db/client";
import { createCharacterRepository } from "@/db/repositories/character-repository";
import { createFamilyRepository } from "@/db/repositories/family-repository";
import { createGenerationRunRepository } from "@/db/repositories/generation-run-repository";
import { createImageGenerationRunRepository } from "@/db/repositories/image-generation-run-repository";
import { createIllustrationRepository } from "@/db/repositories/illustration-repository";
import { createModelRouteRepository } from "@/db/repositories/model-route-repository";
import { createSeriesRepository } from "@/db/repositories/series-repository";
import { createStoryRepository } from "@/db/repositories/story-repository";
import { createFamilyDeletionRepository } from "@/db/repositories/family-deletion-repository";
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
  /**
   * Late-bound holder for the process dispatcher. The illustration job starter
   * (captured in the registry BEFORE the dispatcher is composed in `index.ts`)
   * reads it at run time so a text pipeline can dispatch child image jobs through
   * the SAME dispatcher (so in-process `settled()` tracking still awaits them).
   */
  dispatcherRef: { current: JobDispatcher | null };
}

export async function createWorkflowRuntime(): Promise<WorkflowRuntime> {
  const db = await getDb();
  const familyRepository = createFamilyRepository(db);
  const workflowRepository = createWorkflowRepository(db);
  const characterRepository = createCharacterRepository(db);
  const storyRepository = createStoryRepository(db);
  const visualAssetRepository = createVisualAssetRepository(db);
  const objectStorage = await getObjectStorage();

  const visualCharacterService = createVisualCharacterService({
    familyRepository,
    characterRepository,
    visualAssetRepository,
    objectStorage,
    imageModel: getImageModel(),
  });

  // M6 structured-generation stack (capability routing → pipeline → run records).
  const modelRouteRepository = createModelRouteRepository(db);
  const modelRegistry = createModelRegistry(modelRouteRepository);
  const languageModel = getLanguageModel();
  const structuredGenerator = createStructuredGenerator({
    modelRegistry,
    languageModel,
    pricing: createModelPricing(),
  });
  const generationRunRepository = createGenerationRunRepository(db);
  const seriesRepository = createSeriesRepository(db);

  // M9 chapter-illustration stack.
  const illustrationRepository = createIllustrationRepository(db);
  const imageRunRepository = createImageGenerationRunRepository(db);
  const imageRouteRegistry = createImageRouteRegistry();
  const dispatcherRef: { current: JobDispatcher | null } = { current: null };
  // Bounded per-family concurrency (`image-generation.md`) is honoured by the
  // dispatcher itself: in the dev/e2e in-process dispatcher every drive (text AND
  // image) is SERIALISED (the single-connection PGlite constraint), so background
  // painting never overlaps a foreground text workflow; in production each image
  // job is an independently durable WDK run.
  const illustrationJobStarter: IllustrationJobStarter = {
    async start({ familyId, userId, storyId, specId }) {
      await illustrationRepository.ensurePublicationPending({
        familyId,
        storyId,
        specId,
      });
      const { execution, created } =
        await workflowRepository.createOrGetExecution({
          familyId,
          userId,
          type: GENERATE_ILLUSTRATION_TYPE,
          requestId: `illustration:${specId}`,
          entityId: specId,
          input: { specId },
          initialStage: "prepare",
        });
      if (created && dispatcherRef.current) {
        // Background priority: painting must never starve a parent-facing
        // story/chapter workflow in the serial dev dispatcher (text-first).
        await dispatcherRef.current.dispatch(execution.id, {
          priority: "background",
        });
      }
    },
  };

  const registry = createWorkflowRegistry({
    visualCharacterService,
    structuredGenerator,
    generationRunRepository,
    storyRepository,
    characterRepository,
    seriesRepository,
    modelRouteRepository,
    illustrationRepository,
    illustrationJobStarter,
    visualAssetRepository,
    objectStorage,
    chapterImageModel: getChapterImageModel(),
    visionModel: getVisionModel(),
    imageRunRepository,
    imageRouteRegistry,
    familyDeletionRepository: createFamilyDeletionRepository(db),
    languageModel,
  });
  const engine = createWorkflowEngine({ repo: workflowRepository, registry });

  return {
    engine,
    workflowRepository,
    familyRepository,
    registry,
    dispatcherRef,
  };
}
