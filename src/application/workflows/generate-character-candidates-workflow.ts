import { z } from "zod";

import type { AuthenticatedActor } from "@/domain/actor";
import type { StageResult, WorkflowDefinition } from "../workflow-engine";
import type { VisualCharacterService } from "../visual-character-service";

/**
 * The FIRST real consumer of the workflow engine: painting a character's
 * candidate reference sets (`docs/03-ai/image-generation.md`, ADR-003). In M4
 * this ran synchronously inside a Server Action; M5 moves it onto
 * `startWorkflow` so it is durable, idempotent, and the appearance UI can poll
 * progress — without changing the M4 service, which the stage reuses verbatim.
 *
 * Kept intentionally small — ONE honest stage — because the SYNTHETIC workflow
 * already proves multi-stage resume. Payload is IDs + metadata only
 * (`docs/05-backend/background-jobs.md`): the image BYTES are produced and stored
 * privately inside the service, never carried through the workflow row.
 *
 * The actor is reconstructed inside the stage from the execution's `userId` +
 * `familyId` (the row already records who started it in which family), so the
 * service RE-AUTHORISES `character:manage` against live membership — defence in
 * depth, and no need to snapshot roles into the payload.
 */

export const GENERATE_CHARACTER_CANDIDATES_TYPE =
  "generate-character-candidates";

export const GenerateCandidatesInputSchema = z.object({
  characterId: z.uuid(),
  setCount: z.number().int().min(1).max(4).optional(),
});
export type GenerateCandidatesInput = z.infer<
  typeof GenerateCandidatesInputSchema
>;

export interface GenerateCandidatesWorkflowDeps {
  visualCharacterService: VisualCharacterService;
}

export function createGenerateCharacterCandidatesWorkflow(
  deps: GenerateCandidatesWorkflowDeps,
): WorkflowDefinition<GenerateCandidatesInput> {
  return {
    type: GENERATE_CHARACTER_CANDIDATES_TYPE,
    capability: "character:manage",
    inputSchema: GenerateCandidatesInputSchema,
    // Parent-friendly loading copy (`docs/company/writing-style.md`).
    pendingLabel: "Painting the first set of options",
    entityId: (input) => input.characterId,
    stages: [
      {
        key: "paint-candidates",
        label: "Painting the first set of options",
        run: async (ctx): Promise<StageResult> => {
          const { execution, input } = ctx;
          const command = input as GenerateCandidatesInput;
          // Reconstruct the actor from the durable row. `authorizeFamilyAction`
          // reads the role from live membership, so `roles` here is unused —
          // only `userId` + the primary `familyId` matter.
          const actor: AuthenticatedActor = {
            userId: execution.userId,
            familyIds: [execution.familyId],
            roles: [],
          };
          const sets = await deps.visualCharacterService.requestCandidateSets(
            actor,
            command,
          );
          return { output: { candidateSetIds: sets.map((s) => s.id) } };
        },
      },
    ],
  };
}
