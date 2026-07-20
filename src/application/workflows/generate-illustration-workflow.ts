import { z } from "zod";

import type { ChapterImageModel } from "../ports/chapter-image-model";
import type { ImageGenerationRunRepository } from "../ports/image-generation-run-repository";
import type { IllustrationRepository } from "../ports/illustration-repository";
import type { ObjectStorage } from "../ports/object-storage";
import type { SeriesRepository } from "../ports/series-repository";
import type { VisionModel } from "../ports/vision-model";
import type { CharacterRepository } from "../ports/character-repository";
import type { VisualAssetRepository } from "../ports/visual-asset-repository";
import type { ImageRouteRegistry } from "../model-routes/image-route-registry";
import type {
  StageContext,
  StageResult,
  WorkflowDefinition,
} from "../workflow-engine";
import { MVP_ART_BIBLE } from "@/domain/art-bible";
import {
  buildImageSceneRequest,
  type ImageSceneRequest,
  type IllustrationAspect,
} from "@/domain/image-request";
import {
  decideImageReview,
  IMAGE_PHASES,
  repairInstructionFor,
  type ImagePhase,
  type VisionVerdict,
} from "@/domain/image-job";
import { assertTechnicalImage } from "@/domain/image-technical";
import { nameBasedUuid } from "@/domain/name-uuid";
import {
  selectReferences,
  type SceneChild,
  type SelectedReference,
} from "@/domain/reference-selection";
import type { ReferenceImage } from "@/domain/reference-image";
import { buildIllustrationAssetKey } from "@/domain/storage-keys";
import type { ImageCapability } from "@/domain/model-capability";
import {
  EMPTY_LEDGER,
  imageCallBreach,
  type WorkflowBudget,
} from "@/domain/workflow-budget";
import { DomainError, generationFailedError } from "@/lib/errors";

/**
 * `generate-illustration` — the per-spec chapter illustration job
 * (`docs/03-ai/image-generation.md` "Generation and review"). Dispatched AFTER the
 * text publication commits (M7/M8 publish placeholder slots; this fills them
 * asynchronously) and NEVER blocks or discards approved text on image failure
 * (text-first publication).
 *
 * ONE ENGINE STAGE = ONE REAL IMAGE CALL. The bounded repair ladder is split into
 * three sequential per-phase stages plus a delivery stage, so no single serverless
 * invocation makes more than one image gen + one vision review. A stage that
 * time-outs replays only its OWN phase (idempotently — deterministic ids reproduce
 * the same asset/review/spend), never re-running the whole ladder. Stages:
 *
 *   prepare        → select references (pure, pinned/current visual profiles) + subjects
 *   paint-initial  → phase 1: generate → technical validate → upload quarantined
 *                    original → vision review → app-policy decision (decideImageReview)
 *   paint-repair   → phase 2 (targeted repair). NO-OP unless `paint-initial` asked
 *                    to repair — an approval, or a blocking wrong-identity/count
 *                    failure that decideImageReview will never approve, short-circuits.
 *   paint-escalation → phase 3 (premium escalation). NO-OP unless `paint-repair`
 *                    asked to escalate.
 *   finalise       → approved: approve the stored ORIGINAL + mint an immutable
 *                    revision + publication; manual/failed: publication state only
 *                    (text stays readable, original stays quarantined & undeliverable,
 *                    rule 9). Per ADR-007 there is NO derivative/encode step — the
 *                    approved original is what the reader is served.
 *
 * WRONG IDENTITY / WRONG COUNT is never approvable at any phase (rule 7) — enforced
 * by `decideImageReview` (never reimplemented here). Every image + vision call
 * records an `image_generation_runs` cost row. All ids are deterministic so a
 * crash/resume reproduces the same assets/reviews/spend. Reference bytes are
 * re-resolved from object storage in each phase that paints — they NEVER enter a
 * persisted stage-output payload (IDs/metadata only).
 */

export const GENERATE_ILLUSTRATION_TYPE = "generate-illustration";

/**
 * Per-image-job budget (`docs/06-engineering/cost-management.md`). The generation
 * ladder is `initial → repair → escalation` (3 phases), so `maximumImageCalls` is
 * 3. Each paint phase re-derives the ledger from the image-run rows ALREADY
 * recorded for this workflow (excluding its own, so an idempotent re-record on
 * replay never trips the cap) and fails SAFELY if the ceiling is reached — the
 * explicit authority over the ladder so extending phases can never quietly exceed
 * the budget.
 */
const IMAGE_JOB_BUDGET: WorkflowBudget = {
  maximumTextCalls: 0,
  maximumImageCalls: IMAGE_PHASES.length,
  maximumOutputTokens: 0,
  // Premium escalation (900) + a repair (350) + an initial (350) ≈ 1600; leave
  // headroom so the ceiling bounds a runaway, not the sanctioned ladder.
  maximumEstimatedCostMinorUnits: 3_000,
};

export const GenerateIllustrationInputSchema = z.object({
  specId: z.uuid(),
});
export type GenerateIllustrationInput = z.infer<
  typeof GenerateIllustrationInputSchema
>;

const REFERENCE_BUDGET = { maxReferences: 8 };

interface PreparePayload {
  subjects: { characterKey: string; prominent: boolean }[];
  references: SelectedReference[];
  expectedChildren: { characterKey: string }[];
  expectedCount: number;
}

/**
 * The persisted outcome of one paint phase (IDs/metadata only — never bytes):
 *  - `approved`   → this phase produced an acceptable image (winning fields set);
 *  - `repair`     → not acceptable; the next phase should run a targeted repair;
 *  - `escalate`   → not acceptable; the next phase should run a premium escalation;
 *  - `manual`     → exhausted (escalation not acceptable) → manual review;
 *  - `failed`     → the generation call itself failed;
 *  - `skipped`    → this phase did not run (a prior phase already settled it).
 */
type PhaseOutcome =
  "approved" | "repair" | "escalate" | "manual" | "failed" | "skipped";

interface PaintPhasePayload {
  phase: ImagePhase;
  /** Whether this phase actually painted (false for a short-circuited no-op). */
  ran: boolean;
  outcome: PhaseOutcome;
  /** Failure reasons carried into the NEXT phase's targeted repair instruction. */
  reasons: string[];
  winningAssetId: string | null;
  winningContentType: string | null;
  winningModel: string | null;
  request: ImageSceneRequest | null;
  verdict: VisionVerdict | null;
}

export interface GenerateIllustrationDeps {
  illustrationRepository: IllustrationRepository;
  visualAssetRepository: VisualAssetRepository;
  characterRepository: CharacterRepository;
  seriesRepository: SeriesRepository;
  chapterImageModel: ChapterImageModel;
  visionModel: VisionModel;
  objectStorage: ObjectStorage;
  imageRunRepository: ImageGenerationRunRepository;
  imageRouteRegistry: ImageRouteRegistry;
}

/** SHA-256 of bytes as lowercase hex (Web Crypto — portable, no node import). */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    bytes as unknown as ArrayBuffer,
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Deterministic positive 31-bit seed from stable parts (FNV-1a). */
function seedFrom(...parts: string[]): number {
  let h = 0x811c9dc5;
  const input = parts.join(":");
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h & 0x7fffffff;
}

const GENERATION_CAPABILITY: Record<ImagePhase, ImageCapability> = {
  initial: "routine-chapter-illustration",
  repair: "illustration-repair",
  escalation: "premium-chapter-illustration",
};

/** A short-circuited (not-run) phase output that carries no winning image. */
function skippedPhase(phase: ImagePhase): PaintPhasePayload {
  return {
    phase,
    ran: false,
    outcome: "skipped",
    reasons: [],
    winningAssetId: null,
    winningContentType: null,
    winningModel: null,
    request: null,
    verdict: null,
  };
}

export function createGenerateIllustrationWorkflow(
  deps: GenerateIllustrationDeps,
): WorkflowDefinition<GenerateIllustrationInput> {
  const {
    illustrationRepository,
    visualAssetRepository,
    characterRepository,
    seriesRepository,
    chapterImageModel,
    visionModel,
    objectStorage,
    imageRunRepository,
    imageRouteRegistry,
  } = deps;

  async function requireJob(familyId: string, specId: string) {
    const job = await illustrationRepository.getSpecJob(familyId, specId);
    if (!job) {
      throw generationFailedError({
        retryable: false,
        internalDetail: `Illustration spec ${specId} not found for family ${familyId}.`,
        stage: "illustration.prepare",
      });
    }
    return job;
  }

  type IllustrationJob = Awaited<ReturnType<typeof requireJob>>;

  /**
   * Resolve the selected child references to their APPROVED bytes from object
   * storage. The model-neutral request carries only `assetId`s (it stays pure +
   * snapshot-tested); the workflow — which alone holds objectStorage + the
   * visual-asset repository — turns each selected child reference into its private
   * storage key → bytes so the adapter can condition identity on them (ADR-003,
   * rule 7). Re-resolved fresh in each painting phase; bytes NEVER enter a payload.
   */
  async function resolveReferenceImages(
    familyId: string,
    job: IllustrationJob,
    prep: PreparePayload,
  ): Promise<ReferenceImage[]> {
    const characterIdByKey = new Map<string, string>();
    for (const characterId of job.subjectCharacterIds) {
      const character = await characterRepository.getCharacter(
        familyId,
        characterId,
      );
      if (character) characterIdByKey.set(character.key, characterId);
    }
    const referenceImages: ReferenceImage[] = [];
    for (const ref of prep.references) {
      // Only child-derived references (identity/second-angle/outfit) carry a
      // characterKey + view + resolvable approved bytes; extras (scenery) are not
      // identity anchors and are skipped here.
      if (!ref.characterKey || !ref.view) continue;
      const characterId = characterIdByKey.get(ref.characterKey);
      if (!characterId) continue;
      const asset = await visualAssetRepository.getAsset(
        familyId,
        characterId,
        ref.assetId,
      );
      if (!asset) continue;
      const object = await objectStorage.read(asset.storageKey);
      if (!object) continue;
      referenceImages.push({
        characterKey: ref.characterKey,
        view: ref.view,
        bytes: object.bytes,
        contentType: asset.contentType,
      });
    }
    return referenceImages;
  }

  /**
   * Run ONE paint phase: cost-cap check → generate → technical validate → upload
   * quarantined original → vision review → app-policy decision. Returns the
   * persisted phase outcome. Deterministic ids make a replay reproduce the same
   * asset/review/spend.
   */
  async function runPaintPhase(
    ctx: StageContext,
    phase: ImagePhase,
    priorReasons: string[],
  ): Promise<PaintPhasePayload> {
    const { execution, stageKey } = ctx;
    const { specId } = ctx.input as GenerateIllustrationInput;
    const job = await requireJob(execution.familyId, specId);
    const prep = (await ctx.getStageOutput("prepare")) as PreparePayload;

    const aspect = job.aspect as IllustrationAspect;
    const placements = prep.subjects.map((s) => ({
      characterKey: s.characterKey,
      prominent: s.prominent,
    }));

    // COST CAP — the explicit authority over the ladder. Rebuild the ledger from
    // the image-run rows already recorded for THIS workflow, EXCLUDING this phase's
    // own rows: `recordImageRun` is idempotent per (workflowId, stageKey, phase,
    // kind), so a replay of this phase re-records the same rows — counting them
    // would falsely trip the cap on a legitimate resume. Fail SAFELY before
    // spending if the ceiling is reached.
    const priorRuns = (
      await imageRunRepository.listRunsForWorkflow(execution.id)
    ).filter((r) => r.phase !== phase);
    const ledger = {
      ...EMPTY_LEDGER,
      imageCalls: priorRuns.filter((r) => r.kind === "generation").length,
      estimatedCostMinorUnits: priorRuns.reduce(
        (sum, r) => sum + r.estimatedCostMinorUnits,
        0,
      ),
    };
    if (imageCallBreach(ledger, IMAGE_JOB_BUDGET)) {
      throw generationFailedError({
        retryable: false,
        safeMessage: "This picture could not be finished.",
        internalDetail: `Image-call ceiling reached for workflow ${execution.id} before phase "${phase}".`,
        stage: "illustration.paint",
      });
    }

    const base: PaintPhasePayload = {
      phase,
      ran: true,
      outcome: "failed",
      reasons: priorReasons,
      winningAssetId: null,
      winningContentType: null,
      winningModel: null,
      request: null,
      verdict: null,
    };

    const genRoute = imageRouteRegistry.resolveGeneration(phase);
    const request = buildImageSceneRequest({
      spec: { scene: job.sceneDescription, aspect },
      artBible: MVP_ART_BIBLE,
      placements,
      references: prep.references,
      continuityNotes: [],
      seed: seedFrom(execution.id, phase),
      ...(phase === "initial"
        ? {}
        : { repairInstruction: repairInstructionFor(priorReasons) }),
    });
    base.request = request;

    // Reference bytes re-resolved per phase (never persisted to the payload).
    const referenceImages = await resolveReferenceImages(
      execution.familyId,
      job,
      prep,
    );

    const startedAt = Date.now();
    let generated;
    try {
      generated = await chapterImageModel.generate(
        request,
        genRoute,
        referenceImages,
      );
      assertTechnicalImage(
        {
          bytes: generated.bytes,
          contentType: generated.contentType,
          width: generated.width,
          height: generated.height,
        },
        aspect,
      );
    } catch {
      await imageRunRepository.recordImageRun({
        workflowId: execution.id,
        stageKey,
        familyId: execution.familyId,
        storyId: job.storyId,
        specId,
        capability: GENERATION_CAPABILITY[phase],
        phase,
        kind: "generation",
        target: genRoute.target,
        resolvedModelId: "unknown",
        routeVersion: genRoute.version,
        seed: request.seed,
        outcome: "failed",
        failureKind: "generation",
        imageCount: 0,
        estimatedCostMinorUnits: 0,
        latencyMs: Date.now() - startedAt,
      });
      return { ...base, outcome: "failed" };
    }

    // Upload the QUARANTINED original (deterministic id/key → idempotent).
    const originalId = await nameBasedUuid(execution.id, "original", phase);
    const storageKey = buildIllustrationAssetKey({
      familyId: execution.familyId,
      storyId: job.storyId,
      chapterId: job.chapterId,
      chapterRevisionId: job.chapterRevisionId,
      specId,
      assetId: originalId,
    });
    const checksum = await sha256Hex(generated.bytes);
    await objectStorage.put({
      key: storageKey,
      bytes: generated.bytes,
      contentType: generated.contentType,
      checksum,
    });
    await illustrationRepository.recordOriginal({
      id: originalId,
      familyId: execution.familyId,
      storyId: job.storyId,
      chapterId: job.chapterId,
      chapterRevisionId: job.chapterRevisionId,
      specId,
      phase,
      storageKey,
      contentType: generated.contentType,
      checksum,
      byteSize: generated.bytes.byteLength,
      width: generated.width,
      height: generated.height,
      model: generated.model,
      seed: generated.seed,
    });
    await imageRunRepository.recordImageRun({
      workflowId: execution.id,
      stageKey,
      familyId: execution.familyId,
      storyId: job.storyId,
      specId,
      capability: GENERATION_CAPABILITY[phase],
      phase,
      kind: "generation",
      target: genRoute.target,
      resolvedModelId: generated.model,
      routeVersion: genRoute.version,
      seed: generated.seed,
      outcome: phase,
      imageCount: 1,
      estimatedCostMinorUnits: genRoute.costMinorUnitsPerImage,
      latencyMs: Date.now() - startedAt,
    });

    // VISION REVIEW → structured verdict → app-code policy (decideImageReview
    // owns the decision; wrong identity/count is never approvable, rule 7).
    const reviewRoute = imageRouteRegistry.resolveReview();
    const reviewStart = Date.now();
    const { verdict, model: visionModelId } = await visionModel.review(
      {
        imageBytes: generated.bytes,
        imageContentType: generated.contentType,
        expectedChildren: prep.expectedChildren,
        expectedCount: prep.expectedCount,
        outfitNotes: [],
        propNotes: [],
        tone: job.caption,
        artBibleVersion: MVP_ART_BIBLE.version,
      },
      reviewRoute,
      referenceImages,
    );
    const decision = decideImageReview({ verdict, phase });
    await illustrationRepository.recordReview({
      id: await nameBasedUuid(execution.id, "review", phase),
      familyId: execution.familyId,
      specId,
      workflowId: execution.id,
      phase,
      verdict,
      decision: decision.kind,
    });
    await imageRunRepository.recordImageRun({
      workflowId: execution.id,
      stageKey,
      familyId: execution.familyId,
      storyId: job.storyId,
      specId,
      capability: "illustration-repair",
      phase,
      kind: "review",
      target: reviewRoute.target,
      resolvedModelId: visionModelId,
      routeVersion: reviewRoute.version,
      outcome: decision.kind,
      imageCount: 0,
      estimatedCostMinorUnits: reviewRoute.costMinorUnitsPerImage,
      latencyMs: Date.now() - reviewStart,
    });

    if (decision.kind === "approve") {
      return {
        ...base,
        outcome: "approved",
        reasons: [],
        winningAssetId: originalId,
        winningContentType: generated.contentType,
        winningModel: generated.model,
        verdict,
      };
    }
    // repair / escalate / manual — carry the reasons for the next phase's
    // targeted repair instruction (the ladder policy lives in decideImageReview).
    const outcome: PhaseOutcome =
      decision.kind === "repair"
        ? "repair"
        : decision.kind === "escalate"
          ? "escalate"
          : "manual";
    return { ...base, outcome, reasons: decision.reasons, verdict };
  }

  return {
    type: GENERATE_ILLUSTRATION_TYPE,
    capability: "story:create",
    inputSchema: GenerateIllustrationInputSchema,
    pendingLabel: "Painting this page",
    // Fill-in work: never starves a parent-facing story/chapter workflow in the
    // serial dev dispatcher (text-first, docs/03-ai/image-generation.md).
    dispatchPriority: "background",
    entityId: (input) => input.specId,
    stages: [
      // 1) PREPARE — resolve subjects + select references (pure).
      {
        key: "prepare",
        label: "Sketching this page",
        run: async (ctx: StageContext): Promise<StageResult> => {
          const { execution } = ctx;
          const { specId } = ctx.input as GenerateIllustrationInput;
          const job = await requireJob(execution.familyId, specId);
          await illustrationRepository.ensurePublicationPending({
            familyId: execution.familyId,
            storyId: job.storyId,
            specId,
          });

          // For a series, consume the PINNED visual-profile versions (rule 8);
          // for a one-off, use each character's CURRENT approved reference set.
          const pinned =
            job.storyType === "series"
              ? await seriesRepository.getPinnedVisualProfiles(job.storyId)
              : null;

          const children: SceneChild[] = [];
          const subjects: { characterKey: string; prominent: boolean }[] = [];
          for (const characterId of job.subjectCharacterIds) {
            const character = await characterRepository.getCharacter(
              execution.familyId,
              characterId,
            );
            if (!character) continue;
            const prominent = characterId === job.prominentCharacterId;
            const pinnedProfileId = pinned?.[characterId];
            const refs = pinnedProfileId
              ? await visualAssetRepository.getReferenceSetByProfileId(
                  execution.familyId,
                  pinnedProfileId,
                )
              : await visualAssetRepository.getApprovedReferenceSet(
                  execution.familyId,
                  characterId,
                );
            children.push({
              characterKey: character.key,
              prominent,
              references: refs.map((r) => ({ assetId: r.id, view: r.view })),
            });
            subjects.push({ characterKey: character.key, prominent });
          }

          const references = selectReferences(
            { children, extras: [] },
            REFERENCE_BUDGET,
          );
          const payload: PreparePayload = {
            subjects,
            references,
            expectedChildren: children.map((c) => ({
              characterKey: c.characterKey,
            })),
            expectedCount: subjects.length,
          };
          return { output: payload as unknown as Record<string, unknown> };
        },
      },

      // 2) PAINT-INITIAL — the first ladder phase (always runs).
      {
        key: "paint-initial",
        label: "Painting this page",
        run: async (ctx: StageContext): Promise<StageResult> => {
          const result = await runPaintPhase(ctx, "initial", []);
          return { output: result as unknown as Record<string, unknown> };
        },
      },

      // 3) PAINT-REPAIR — the targeted repair phase. NO-OP unless the initial
      //    phase asked to repair (an approval, or a blocking wrong-identity/count
      //    failure decideImageReview will never approve, short-circuits here).
      {
        key: "paint-repair",
        label: "Refining this page",
        run: async (ctx: StageContext): Promise<StageResult> => {
          const initial = (await ctx.getStageOutput("paint-initial")) as
            PaintPhasePayload | undefined;
          if (!initial || initial.outcome !== "repair") {
            return {
              output: skippedPhase("repair") as unknown as Record<
                string,
                unknown
              >,
            };
          }
          const result = await runPaintPhase(ctx, "repair", initial.reasons);
          return { output: result as unknown as Record<string, unknown> };
        },
      },

      // 4) PAINT-ESCALATION — the premium escalation phase. NO-OP unless the
      //    repair phase asked to escalate.
      {
        key: "paint-escalation",
        label: "Repainting this page in finer detail",
        run: async (ctx: StageContext): Promise<StageResult> => {
          const repair = (await ctx.getStageOutput("paint-repair")) as
            PaintPhasePayload | undefined;
          if (!repair || repair.outcome !== "escalate") {
            return {
              output: skippedPhase("escalation") as unknown as Record<
                string,
                unknown
              >,
            };
          }
          const result = await runPaintPhase(ctx, "escalation", repair.reasons);
          return { output: result as unknown as Record<string, unknown> };
        },
      },

      // 5) FINALISE — approve the stored ORIGINAL from whichever phase approved +
      //    mint the immutable revision, or record the terminal non-approved state.
      //    No encode/derivative step (ADR-007): the reader is served the approved
      //    original. Never touches the chapter text.
      {
        key: "finalise",
        label: "Framing this page",
        run: async (ctx: StageContext): Promise<StageResult> => {
          const { execution } = ctx;
          const { specId } = ctx.input as GenerateIllustrationInput;
          const job = await requireJob(execution.familyId, specId);

          const phases = (
            await Promise.all([
              ctx.getStageOutput("paint-initial"),
              ctx.getStageOutput("paint-repair"),
              ctx.getStageOutput("paint-escalation"),
            ])
          ).filter((p): p is PaintPhasePayload =>
            Boolean(p),
          ) as PaintPhasePayload[];

          const approved = phases.find(
            (p) => p.ran && p.outcome === "approved",
          );

          if (!approved) {
            // Terminal non-approved: the LAST phase that ran decides between
            // manual review (escalation exhausted) and a hard failure. Text stays
            // readable; the quarantined original stays undeliverable (rule 9).
            const ran = phases.filter((p) => p.ran);
            const last = ran[ran.length - 1];
            const manual = last?.outcome === "manual";
            await illustrationRepository.setPublicationState({
              familyId: execution.familyId,
              storyId: job.storyId,
              specId,
              state: manual ? "manual-review" : "failed",
            });
            return { output: { state: manual ? "manual" : "failed" } };
          }

          if (
            !approved.winningAssetId ||
            !approved.request ||
            !approved.verdict ||
            !approved.winningContentType
          ) {
            throw new DomainError({
              code: "GENERATION_FAILED",
              safeMessage: "This picture could not be finished.",
              internalDetail: `Approved phase payload missing fields for spec ${specId}.`,
              retryable: false,
              stage: "illustration.finalise",
            });
          }

          // ADR-007: no encode/resize step. The approved original (already
          // uploaded + recorded quarantined in its paint phase) is what gets
          // delivered; `publishApproved` just flips it to `approved` and mints the
          // revision.
          const revisionNumber = job.latestRevisionNumber + 1;
          await illustrationRepository.publishApproved({
            familyId: execution.familyId,
            storyId: job.storyId,
            chapterId: job.chapterId,
            chapterRevisionId: job.chapterRevisionId,
            specId,
            originalAssetId: approved.winningAssetId,
            revisionId: await nameBasedUuid(
              "illustration-revision",
              execution.id,
            ),
            revisionNumber,
            publicationId: await nameBasedUuid(
              "illustration-publication",
              specId,
            ),
            model: approved.winningModel ?? "unknown",
            artBibleVersion: MVP_ART_BIBLE.version,
            imageRouteVersion: imageRouteRegistry.resolveReview().version,
            requestSnapshot: approved.request,
            verdictSnapshot: approved.verdict,
          });
          return {
            output: {
              state: "approved",
              revisionNumber,
            },
          };
        },
      },
    ],
  };
}
