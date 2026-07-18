import type { VisualCharacterService } from "./visual-character-service";
import {
  asWorkflowDefinition,
  type AnyWorkflowDefinition,
  type WorkflowRegistry,
} from "./workflow-engine";
import { createGenerateCharacterCandidatesWorkflow } from "./workflows/generate-character-candidates-workflow";
import { createSyntheticWorkflowDefinition } from "./workflows/synthetic-workflow";

/**
 * Assembles the production workflow REGISTRY (type → definition). Dependency-
 * injected so the composition root supplies the real services and tests can
 * supply fakes or a bespoke synthetic definition. Adding a new workflow type
 * (create-one-off-story, generate-chapter, …) is a one-line registration here.
 */
export interface WorkflowRegistryDeps {
  visualCharacterService: VisualCharacterService;
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
  ];

  return Object.fromEntries(definitions.map((def) => [def.type, def]));
}
