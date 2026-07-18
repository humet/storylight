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
import { getImageModel } from "@/adapters/images";
import { getObjectStorage } from "@/adapters/storage/object-storage";
import { getDb } from "@/db/client";
import { createCharacterRepository } from "@/db/repositories/character-repository";
import { createFamilyRepository } from "@/db/repositories/family-repository";
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

  const visualCharacterService = createVisualCharacterService({
    familyRepository,
    characterRepository: createCharacterRepository(db),
    visualAssetRepository: createVisualAssetRepository(db),
    objectStorage: await getObjectStorage(),
    imageModel: getImageModel(),
  });

  const registry = createWorkflowRegistry({ visualCharacterService });
  const engine = createWorkflowEngine({ repo: workflowRepository, registry });

  return { engine, workflowRepository, familyRepository, registry };
}
