import { z } from "zod";

import type { AuthenticatedActor } from "@/domain/actor";
import type { WorkflowExecution } from "@/domain/workflow";
import {
  ANCHOR_REFERENCE_VIEW,
  REFERENCE_VIEW_LABELS,
  REFERENCE_VIEWS,
} from "@/domain/reference-view";
import {
  EMPTY_LEDGER,
  imageCallBreach,
  type WorkflowBudget,
} from "@/domain/workflow-budget";
import { generationFailedError } from "@/lib/errors";
import type { NewVisualAsset } from "../ports/visual-asset-repository";
import type {
  StageContext,
  StageResult,
  WorkflowDefinition,
  WorkflowStage,
} from "../workflow-engine";
import type { VisualCharacterService } from "../visual-character-service";

/**
 * M4 candidate generation as a durable workflow (`docs/03-ai/image-generation.md`,
 * ADR-003). ONE ENGINE STAGE = ONE REAL IMAGE CALL: the six canonical reference
 * views each get their own short, idempotent stage, then a final assembly stage
 * records the candidate set from the six persisted assets.
 *
 * COHERENT SET (ADR-003 "generate additional views from the approved candidate
 * rather than independently"): the ANCHOR view (`ANCHOR_REFERENCE_VIEW`, the
 * everyday full-body outfit) is painted FIRST and establishes the canonical face,
 * hair and complete outfit. Every OTHER view stage reads the anchor's storage key
 * from the anchor stage's output and passes it to the service, which conditions
 * that view on the anchor's bytes — so all six views are the SAME child in the
 * SAME outfit rather than six independent, self-contradicting guesses. Ordering
 * (anchor stage first) is the only structural change; the one-image-per-stage WDK
 * shape, deterministic per-view ids, idempotency, and the image-call cap are
 * unchanged.
 *
 * WHY: a stage that made all six image calls in one serverless invocation exceeded
 * the function max-duration, so Vercel Workflow (WDK) replayed the WHOLE stage —
 * re-spending on every real image call and never finishing. With one call per
 * stage a time-out replays only a single view (idempotently: deterministic
 * ids/keys reproduce the exact asset/bytes), and the engine skips already-completed
 * views on replay.
 *
 * SINGLE SET: `setCount` is fixed to ONE candidate set for now — fanning out to
 * multiple sets would multiply the per-run call count again (`setCount × 6`). A
 * multi-set fan-out is a documented follow-up (BUILD_STATE), not this task; the
 * legacy `setCount` field is still accepted so existing callers don't break, but it
 * is ignored here.
 *
 * IDEMPOTENCY: each stage passes `idempotencyKey = execution.id`, so the
 * candidate-set id, per-view asset ids, seeds, and storage keys are derived
 * deterministically. The per-view stages upload quarantined bytes only; the DB
 * candidate-set record appears atomically in the final `record-candidate-set`
 * stage. Stage-output payloads are IDs/metadata only — never image bytes.
 */

export const GENERATE_CHARACTER_CANDIDATES_TYPE =
  "generate-character-candidates";

export const GenerateCandidatesInputSchema = z.object({
  characterId: z.uuid(),
  /** Legacy field: accepted for compatibility but ignored — always one set now. */
  setCount: z.number().int().min(1).max(4).optional(),
});
export type GenerateCandidatesInput = z.infer<
  typeof GenerateCandidatesInputSchema
>;

/** The single candidate set painted per run (multi-set fan-out is a follow-up). */
const SET_INDEX = 0;

/**
 * COST SAFETY NET (`docs/06-engineering/cost-management.md`): a hard per-workflow
 * ceiling on image-model calls so a bug can never run away with real image spend.
 * Exactly one image call happens per view stage and none in the record stage, so
 * the ceiling is the view count. The check counts image calls ALREADY durably
 * completed on this run (one per finished view stage) and fails SAFELY (a
 * non-retryable error) before spending if the ceiling is reached — a structural
 * guard that would trip only if the stage list were ever mis-extended.
 */
const CANDIDATE_IMAGE_BUDGET: WorkflowBudget = {
  maximumTextCalls: 0,
  maximumImageCalls: REFERENCE_VIEWS.length,
  maximumOutputTokens: 0,
  maximumEstimatedCostMinorUnits: Number.MAX_SAFE_INTEGER,
};

export interface GenerateCandidatesWorkflowDeps {
  visualCharacterService: VisualCharacterService;
}

/**
 * Reconstruct the actor from the durable row. `authorizeFamilyAction` reads the
 * role from live membership, so `roles` here is unused — only `userId` + the
 * primary `familyId` matter.
 */
function actorFrom(execution: WorkflowExecution): AuthenticatedActor {
  return {
    userId: execution.userId,
    familyIds: [execution.familyId],
    roles: [],
  };
}

function paintViewStageKey(view: (typeof REFERENCE_VIEWS)[number]): string {
  return `paint-${view}`;
}

/**
 * Paint order: the ANCHOR view FIRST, then the remaining views in canonical
 * order. The anchor must exist before any view that conditions on it. (The
 * recorded set is still assembled in `REFERENCE_VIEWS` order — front portrait
 * first — by the record stage; this only governs generation order.)
 */
const ORDERED_PAINT_VIEWS = [
  ANCHOR_REFERENCE_VIEW,
  ...REFERENCE_VIEWS.filter((view) => view !== ANCHOR_REFERENCE_VIEW),
];

export function createGenerateCharacterCandidatesWorkflow(
  deps: GenerateCandidatesWorkflowDeps,
): WorkflowDefinition<GenerateCandidatesInput> {
  const paintStages: WorkflowStage[] = ORDERED_PAINT_VIEWS.map((view) => ({
    key: paintViewStageKey(view),
    // Parent-friendly loading copy (`docs/company/writing-style.md`).
    label: `Painting the ${REFERENCE_VIEW_LABELS[view].toLowerCase()}`,
    run: async (ctx: StageContext): Promise<StageResult> => {
      const { execution } = ctx;
      const { characterId } = ctx.input as GenerateCandidatesInput;

      // COST CAP: count the image calls already durably completed on THIS run —
      // one per finished view stage. A view stage only runs when its OWN output is
      // absent (the engine skips completed stages), so its own call is never in
      // this count. Fail safely before spending if the ceiling is reached.
      let completedImageCalls = 0;
      for (const other of REFERENCE_VIEWS) {
        if (other === view) continue;
        if (await ctx.getStageOutput(paintViewStageKey(other))) {
          completedImageCalls += 1;
        }
      }
      const ledger = { ...EMPTY_LEDGER, imageCalls: completedImageCalls };
      if (imageCallBreach(ledger, CANDIDATE_IMAGE_BUDGET)) {
        throw generationFailedError({
          retryable: false,
          safeMessage: "We couldn't finish painting these options.",
          internalDetail: `Image-call ceiling ${CANDIDATE_IMAGE_BUDGET.maximumImageCalls} reached for workflow ${execution.id} at view "${view}".`,
          stage: "visual.paint",
        });
      }

      // COHERENT SET: every NON-anchor view conditions on the anchor the first
      // stage already painted. The anchor's storage key lives in its stage output
      // (IDs/metadata only — never bytes); the service reads the bytes itself.
      let anchorStorageKey: string | undefined;
      if (view !== ANCHOR_REFERENCE_VIEW) {
        const anchor = (await ctx.getStageOutput(
          paintViewStageKey(ANCHOR_REFERENCE_VIEW),
        )) as NewVisualAsset | undefined;
        if (!anchor) {
          throw generationFailedError({
            retryable: false,
            internalDetail: `Anchor view "${ANCHOR_REFERENCE_VIEW}" was not painted before "${view}" for workflow ${execution.id}.`,
            stage: "visual.paint",
          });
        }
        anchorStorageKey = anchor.storageKey;
      }

      const asset = await deps.visualCharacterService.generateCandidateView(
        actorFrom(execution),
        {
          characterId,
          setIndex: SET_INDEX,
          view,
          // Stable per workflow run: makes the paid side effect idempotent across a
          // crash/replay (same candidate-set + asset ids, keys, and bytes).
          idempotencyKey: execution.id,
          anchorStorageKey,
        },
      );
      return { output: asset as unknown as Record<string, unknown> };
    },
  }));

  const recordStage: WorkflowStage = {
    key: "record-candidate-set",
    label: "Framing the options",
    run: async (ctx: StageContext): Promise<StageResult> => {
      const { execution } = ctx;
      const { characterId } = ctx.input as GenerateCandidatesInput;

      // Assemble the six persisted per-view assets (IDs/metadata only) into the
      // candidate-set record. Every view must be present — the engine only reaches
      // this stage after all six paint stages advanced.
      const assets: NewVisualAsset[] = [];
      for (const view of REFERENCE_VIEWS) {
        const asset = (await ctx.getStageOutput(paintViewStageKey(view))) as
          NewVisualAsset | undefined;
        if (!asset) {
          throw generationFailedError({
            retryable: false,
            internalDetail: `Missing painted view "${view}" for workflow ${execution.id}.`,
            stage: "visual.record",
          });
        }
        assets.push(asset);
      }

      const set = await deps.visualCharacterService.assembleCandidateSet(
        actorFrom(execution),
        {
          characterId,
          setIndex: SET_INDEX,
          idempotencyKey: execution.id,
          assets,
        },
      );
      return { output: { candidateSetIds: [set.id] } };
    },
  };

  return {
    type: GENERATE_CHARACTER_CANDIDATES_TYPE,
    capability: "character:manage",
    inputSchema: GenerateCandidatesInputSchema,
    pendingLabel: "Painting the first set of options",
    entityId: (input) => input.characterId,
    stages: [...paintStages, recordStage],
  };
}
