import { z } from "zod";

import type { ChapterImageModel } from "../ports/chapter-image-model";
import type { ImageDerivatives } from "../ports/image-derivatives";
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
import { buildIllustrationAssetKey } from "@/domain/storage-keys";
import type { ImageCapability } from "@/domain/model-capability";
import { DomainError, generationFailedError } from "@/lib/errors";

/**
 * `generate-illustration` — the per-spec chapter illustration job
 * (`docs/03-ai/image-generation.md` "Generation and review"). Dispatched AFTER the
 * text publication commits (M7/M8 publish placeholder slots; this fills them
 * asynchronously) and NEVER blocks or discards approved text on image failure
 * (text-first publication). Stages:
 *
 *   prepare  → select references (pure, pinned/current visual profiles) + subjects
 *   paint    → the bounded repair ladder: for each phase generate → technical
 *              validate → upload quarantined original → vision review → app-policy
 *              decision. Budget EXACTLY initial → 1 repair → 1 premium escalation →
 *              manual. WRONG IDENTITY / WRONG COUNT is never approvable (rule 7).
 *   finalise → approved: derivatives (sharp) + immutable illustration revision +
 *              publication; manual/failed: publication state only (text stays
 *              readable, original stays quarantined & undeliverable, rule 9).
 *
 * Every image + vision call records an `image_generation_runs` cost row. All ids
 * are deterministic so a crash/resume reproduces the same assets/reviews/spend.
 */

export const GENERATE_ILLUSTRATION_TYPE = "generate-illustration";

export const GenerateIllustrationInputSchema = z.object({
  specId: z.uuid(),
});
export type GenerateIllustrationInput = z.infer<
  typeof GenerateIllustrationInputSchema
>;

// Responsive widths that cover common phone/tablet reader viewports without
// over-encoding (cost-management.md; keeps the single-process dev/e2e harness fast).
const DERIVATIVE_WIDTHS = [360, 720];
const REFERENCE_BUDGET = { maxReferences: 8 };

interface PreparePayload {
  subjects: { characterKey: string; prominent: boolean }[];
  references: SelectedReference[];
  expectedChildren: { characterKey: string }[];
  expectedCount: number;
}

interface PaintPayload {
  decision: "approved" | "manual" | "failed";
  winningPhase: ImagePhase | null;
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
  imageDerivatives: ImageDerivatives;
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
    imageDerivatives,
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

      // 2) PAINT — the bounded repair ladder.
      {
        key: "paint",
        label: "Painting this page",
        run: async (ctx: StageContext): Promise<StageResult> => {
          const { execution, stageKey } = ctx;
          const { specId } = ctx.input as GenerateIllustrationInput;
          const job = await requireJob(execution.familyId, specId);
          const prep = (await ctx.getStageOutput("prepare")) as PreparePayload;

          const aspect = job.aspect as IllustrationAspect;
          const placements = prep.subjects.map((s) => ({
            characterKey: s.characterKey,
            prominent: s.prominent,
          }));

          let repairReasons: string[] = [];
          let result: PaintPayload = {
            decision: "failed",
            winningPhase: null,
            winningAssetId: null,
            winningContentType: null,
            winningModel: null,
            request: null,
            verdict: null,
          };

          for (const phase of IMAGE_PHASES) {
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
                : { repairInstruction: repairInstructionFor(repairReasons) }),
            });

            const startedAt = Date.now();
            let generated;
            try {
              generated = await chapterImageModel.generate(request, genRoute);
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
              result = { ...result, decision: "failed" };
              break;
            }

            // Upload the QUARANTINED original (deterministic id/key → idempotent).
            const originalId = await nameBasedUuid(
              execution.id,
              "original",
              phase,
            );
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

            // VISION REVIEW → structured verdict → app-code policy.
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
              result = {
                decision: "approved",
                winningPhase: phase,
                winningAssetId: originalId,
                winningContentType: generated.contentType,
                winningModel: generated.model,
                request,
                verdict,
              };
              break;
            }
            if (decision.kind === "manual") {
              result = { ...result, decision: "manual", verdict };
              break;
            }
            // repair / escalate → carry the reasons into the next phase's instruction.
            repairReasons = decision.reasons;
          }

          return { output: result as unknown as Record<string, unknown> };
        },
      },

      // 3) FINALISE — publish approved (derivatives + revision) or record the
      //    terminal non-approved state. Never touches the chapter text.
      {
        key: "finalise",
        label: "Framing this page",
        run: async (ctx: StageContext): Promise<StageResult> => {
          const { execution } = ctx;
          const { specId } = ctx.input as GenerateIllustrationInput;
          const job = await requireJob(execution.familyId, specId);
          const paint = (await ctx.getStageOutput("paint")) as PaintPayload;

          if (paint.decision !== "approved") {
            await illustrationRepository.setPublicationState({
              familyId: execution.familyId,
              storyId: job.storyId,
              specId,
              state: paint.decision === "manual" ? "manual-review" : "failed",
            });
            return { output: { state: paint.decision } };
          }

          if (
            !paint.winningAssetId ||
            !paint.request ||
            !paint.verdict ||
            !paint.winningContentType
          ) {
            throw new DomainError({
              code: "GENERATION_FAILED",
              safeMessage: "This picture could not be finished.",
              internalDetail: `Approved paint payload missing fields for spec ${specId}.`,
              retryable: false,
              stage: "illustration.finalise",
            });
          }

          // Read the approved original bytes to derive responsive variants.
          const originalKey = buildIllustrationAssetKey({
            familyId: execution.familyId,
            storyId: job.storyId,
            chapterId: job.chapterId,
            chapterRevisionId: job.chapterRevisionId,
            specId,
            assetId: paint.winningAssetId,
          });
          const original = await objectStorage.read(originalKey);
          if (!original) {
            throw generationFailedError({
              retryable: true,
              internalDetail: `Approved original ${originalKey} missing from storage.`,
              stage: "illustration.finalise",
            });
          }

          const derived = await imageDerivatives.derive(
            { bytes: original.bytes, contentType: paint.winningContentType },
            DERIVATIVE_WIDTHS,
          );
          const derivatives = [];
          for (const d of derived) {
            const id = await nameBasedUuid(
              execution.id,
              "derivative",
              d.format,
              String(d.width),
            );
            const key = buildIllustrationAssetKey({
              familyId: execution.familyId,
              storyId: job.storyId,
              chapterId: job.chapterId,
              chapterRevisionId: job.chapterRevisionId,
              specId,
              assetId: id,
            });
            const checksum = await sha256Hex(d.bytes);
            await objectStorage.put({
              key,
              bytes: d.bytes,
              contentType: d.contentType,
              checksum,
            });
            derivatives.push({
              id,
              storageKey: key,
              contentType: d.contentType,
              checksum,
              byteSize: d.bytes.byteLength,
              width: d.width,
              height: d.height,
              variantWidth: d.width,
            });
          }

          const revisionNumber = job.latestRevisionNumber + 1;
          await illustrationRepository.publishApproved({
            familyId: execution.familyId,
            storyId: job.storyId,
            chapterId: job.chapterId,
            chapterRevisionId: job.chapterRevisionId,
            specId,
            originalAssetId: paint.winningAssetId,
            revisionId: await nameBasedUuid(
              "illustration-revision",
              execution.id,
            ),
            revisionNumber,
            publicationId: await nameBasedUuid(
              "illustration-publication",
              specId,
            ),
            model: paint.winningModel ?? "unknown",
            artBibleVersion: MVP_ART_BIBLE.version,
            imageRouteVersion: imageRouteRegistry.resolveReview().version,
            requestSnapshot: paint.request,
            verdictSnapshot: paint.verdict,
            derivatives,
          });
          return {
            output: {
              state: "approved",
              revisionNumber,
              derivatives: derivatives.length,
            },
          };
        },
      },
    ],
  };
}
