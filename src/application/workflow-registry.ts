import type { StructuredGenerator } from "./ai/generate-structured";
import type { CharacterRepository } from "./ports/character-repository";
import type { GenerationRunRepository } from "./ports/generation-run-repository";
import type { ModelRouteRepository } from "./ports/model-route-repository";
import type { SeriesRepository } from "./ports/series-repository";
import type { StoryRepository } from "./ports/story-repository";
import type { VisualCharacterService } from "./visual-character-service";
import {
  asWorkflowDefinition,
  type AnyWorkflowDefinition,
  type WorkflowRegistry,
} from "./workflow-engine";
import { createCreateOneOffStoryWorkflow } from "./workflows/create-one-off-story-workflow";
import { createCreateSeriesWorkflow } from "./workflows/create-series-workflow";
import { createGenerateNextChapterWorkflow } from "./workflows/generate-next-chapter-workflow";
import { createGenerateCharacterCandidatesWorkflow } from "./workflows/generate-character-candidates-workflow";
import { createStructuredPlanDemoWorkflow } from "./workflows/structured-plan-demo-workflow";
import { createSyntheticWorkflowDefinition } from "./workflows/synthetic-workflow";

/**
 * Assembles the production workflow REGISTRY (type → definition). Dependency-
 * injected so the composition root supplies the real services and tests can
 * supply fakes or a bespoke synthetic definition. Adding a new workflow type
 * (create-one-off-story, generate-chapter, …) is a one-line registration here.
 */
export interface WorkflowRegistryDeps {
  visualCharacterService: VisualCharacterService;
  /** M6 structured-generation pipeline + its persistence, for the demo workflow. */
  structuredGenerator: StructuredGenerator;
  generationRunRepository: GenerationRunRepository;
  /**
   * M7 one-off story pipeline dependencies. Optional so tests that only exercise
   * earlier workflows need not supply them; the one-off workflow is registered
   * only when BOTH are present.
   */
  storyRepository?: StoryRepository;
  characterRepository?: CharacterRepository;
  /**
   * M8 series pipeline dependencies. Optional so earlier-only tests need not
   * supply them; the series workflows register only when all are present.
   */
  seriesRepository?: SeriesRepository;
  modelRouteRepository?: ModelRouteRepository;
}

export function createWorkflowRegistry(
  deps: WorkflowRegistryDeps,
): WorkflowRegistry {
  const definitions: AnyWorkflowDefinition[] = [
    // A dev-only synthetic workflow (plain marker outputs) so the engine has a
    // trigger to exercise in a running app; the resume/retry tests build their
    // own instrumented synthetic definition.
    asWorkflowDefinition(createSyntheticWorkflowDefinition()),
    // The first real consumer: painting character candidate reference sets.
    asWorkflowDefinition(
      createGenerateCharacterCandidatesWorkflow({
        visualCharacterService: deps.visualCharacterService,
      }),
    ),
    // M6 exit demonstration: a structured artifact through the full pipeline.
    asWorkflowDefinition(
      createStructuredPlanDemoWorkflow({
        structuredGenerator: deps.structuredGenerator,
        generationRunRepository: deps.generationRunRepository,
      }),
    ),
  ];

  // M7: the first end-to-end user-facing pipeline — a one-off story. Registered
  // only when its persistence dependencies are supplied.
  if (deps.storyRepository && deps.characterRepository) {
    definitions.push(
      asWorkflowDefinition(
        createCreateOneOffStoryWorkflow({
          structuredGenerator: deps.structuredGenerator,
          generationRunRepository: deps.generationRunRepository,
          storyRepository: deps.storyRepository,
          characterRepository: deps.characterRepository,
        }),
      ),
    );
  }

  // M8: the series pipeline (create-series + generate-next-chapter). Registered
  // only when its persistence dependencies are all supplied.
  if (
    deps.storyRepository &&
    deps.characterRepository &&
    deps.seriesRepository &&
    deps.modelRouteRepository
  ) {
    const chapterDeps = {
      structuredGenerator: deps.structuredGenerator,
      generationRunRepository: deps.generationRunRepository,
      seriesRepository: deps.seriesRepository,
      storyRepository: deps.storyRepository,
      characterRepository: deps.characterRepository,
    };
    definitions.push(
      asWorkflowDefinition(
        createCreateSeriesWorkflow({
          ...chapterDeps,
          modelRouteRepository: deps.modelRouteRepository,
        }),
      ),
      asWorkflowDefinition(createGenerateNextChapterWorkflow(chapterDeps)),
    );
  }

  return Object.fromEntries(definitions.map((def) => [def.type, def]));
}
