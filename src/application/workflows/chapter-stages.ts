import type { CharacterRepository } from "../ports/character-repository";
import type { GenerationRunRepository } from "../ports/generation-run-repository";
import type { IllustrationRepository } from "../ports/illustration-repository";
import type { IllustrationJobStarter } from "../ports/illustration-job-starter";
import type { SeriesRepository } from "../ports/series-repository";
import type { StoryRepository } from "../ports/story-repository";
import { createDispatchIllustrationsStage } from "./illustration-dispatch";
import type {
  StageContext,
  StageResult,
  WorkflowStage,
} from "../workflow-engine";
import type {
  StructuredGenerationOutcome,
  StructuredGenerator,
} from "../ai/generate-structured";
import { chapterPlanningPrompt } from "../prompts/chapter-planning.prompt";
import { chapterWritingPrompt } from "../prompts/chapter-writing.prompt";
import { chapterRevisionPrompt } from "../prompts/chapter-revision.prompt";
import { oneOffReviewPrompt } from "../prompts/one-off-review.prompt";
import { oneOffIllustrationPrompt } from "../prompts/one-off-illustration.prompt";
import { continuityExtractionPrompt } from "../prompts/continuity-extraction.prompt";
import {
  chapterPlanWireSchema,
  type ChapterPlanWire,
} from "../schemas/chapter-plan.schema";
import {
  chapterDraftWireSchema,
  type ChapterDraftWire,
} from "../schemas/chapter-draft.schema";
import {
  chapterReviewWireSchema,
  type ChapterReviewWire,
} from "../schemas/chapter-review.schema";
import {
  continuityChangeWireSchema,
  type ContinuityChangeWire,
} from "../schemas/continuity-change.schema";
import {
  illustrationPlanWireSchema,
  type IllustrationPlanWire,
} from "../schemas/illustration-plan.schema";
import type { LanguageCapability } from "@/domain/model-capability";
import type { PinnedRouteProfile } from "@/domain/model-route";
import {
  applyContinuityChanges,
  continuitySummary,
  crossReferenceContinuityChange,
  normaliseContinuityChange,
  type ContinuityChangeSet,
  type ContinuityState,
  type PlotThreadStatus,
} from "@/domain/continuity";
import { blueprintForChapter } from "@/domain/series-bible";
import {
  decideReviewOutcome,
  type ReviewArtifact,
} from "@/domain/review-policy";
import type { StoryDna } from "@/domain/story-dna";
import {
  countDraftWords,
  validateDraftAgainstPlan,
  MAX_ILLUSTRATIONS,
  type ChapterDraft,
  type OneOffPlan,
} from "@/domain/story-draft";
import {
  crossReferenceChapterDraft,
  crossReferenceIllustrationPlan,
  crossReferenceOneOffPlan,
  normaliseChapterDraft,
  normaliseIllustrationPlan,
  normaliseOneOffPlan,
  validateOneOffPlan,
  type IllustrationSpec,
} from "@/domain/one-off-artifacts";
import type { WorkflowBudget } from "@/domain/workflow-budget";
import { DomainError, generationFailedError } from "@/lib/errors";

/**
 * The SHARED next-chapter stages (`docs/03-ai/orchestration.md` "Chapter
 * generation sequence"), used by BOTH the create-series workflow (for Chapter 1,
 * after the bible is persisted) and the generate-next-chapter workflow. Each stage
 * is IDEMPOTENT (deterministic ids; recorded artifacts are the resume anchors) per
 * the M5 contract. Models NEVER write canonical state (domain rule 3): the publish
 * stage is an app-code transaction consuming validated artifacts; continuity
 * advances ONLY through the pure `applyContinuityChanges`.
 *
 * Sequence: chapter-context (app) → chapter-plan (model) → chapter-draft (model) →
 * chapter-review (model, advisory) → chapter-finalise (APP policy + ≤2 revisions) →
 * chapter-continuity (model → validate + apply → new snapshot) → chapter-illustration
 * (model, specs only, M9 fills bytes) → chapter-publish (app, atomic).
 */

export const CHAPTER_STAGE_KEYS = [
  "chapter-context",
  "chapter-plan",
  "chapter-draft",
  "chapter-review",
  "chapter-finalise",
  "chapter-continuity",
  "chapter-illustration",
  "chapter-publish",
  "chapter-dispatch-illustrations",
] as const;

const STEP_BUDGET: WorkflowBudget = {
  maximumTextCalls: 4,
  maximumImageCalls: 0,
  maximumOutputTokens: 20_000,
  maximumEstimatedCostMinorUnits: 10_000,
};

export interface ChapterStagesDeps {
  structuredGenerator: StructuredGenerator;
  generationRunRepository: GenerationRunRepository;
  seriesRepository: SeriesRepository;
  storyRepository: StoryRepository;
  characterRepository: CharacterRepository;
  /**
   * M9: dispatch per-spec image jobs after the chapter publication commits.
   * Optional so earlier-only tests need not supply the image stack — when absent
   * the final dispatch stage is omitted (text still publishes with pending slots).
   */
  illustrationRepository?: IllustrationRepository;
  illustrationJobStarter?: IllustrationJobStarter;
}

interface ChapterContextOutput {
  chapterNumber: number;
  isFirstChapter: boolean;
  isFinalChapter: boolean;
}

interface ChapterFinalPayload {
  draft: ChapterDraft;
  review: ReviewArtifact;
  decision: string;
  revisionsUsed: number;
}

interface ContinuityStagePayload {
  changeset: ContinuityChangeSet;
  nextState: ContinuityState;
  threadStates: { threadKey: string; status: PlotThreadStatus }[];
}

const ACCEPTED_OUTCOMES = new Set(["accepted", "repaired", "regenerated"]);

/** Cast projection for the model contexts (keys + names + ages). */
function castOf(dna: StoryDna) {
  return dna.characters.map((c) => ({
    key: c.key,
    name: c.name,
    apparentAge: c.apparentAge,
  }));
}

export function createChapterStages(deps: ChapterStagesDeps): WorkflowStage[] {
  const { structuredGenerator, generationRunRepository, seriesRepository } =
    deps;

  async function persist<Domain>(
    ids: {
      workflowId: string;
      stageKey: string;
      familyId: string;
      capability: LanguageCapability;
    },
    outcome: StructuredGenerationOutcome<Domain>,
    kind: string,
  ): Promise<Domain> {
    const acceptedAttemptIndex = outcome.ok
      ? outcome.attempts.find((a) => ACCEPTED_OUTCOMES.has(a.outcome))
          ?.attemptIndex
      : undefined;
    await generationRunRepository.recordGeneration({
      workflowId: ids.workflowId,
      stageKey: ids.stageKey,
      familyId: ids.familyId,
      capability: ids.capability,
      attempts: outcome.attempts,
      artifact: outcome.ok
        ? {
            schemaVersion: outcome.schemaVersion,
            kind,
            payload: outcome.artifact,
          }
        : undefined,
      acceptedAttemptIndex,
    });
    if (!outcome.ok) throw outcome.error;
    return outcome.artifact;
  }

  async function readArtifact<T>(
    workflowId: string,
    stageKey: string,
  ): Promise<T> {
    const artifact = await generationRunRepository.getArtifact(
      workflowId,
      stageKey,
    );
    if (!artifact) {
      throw generationFailedError({
        retryable: true,
        internalDetail: `Missing artifact for stage "${stageKey}" of workflow ${workflowId}.`,
        stage: "chapter.resume",
      });
    }
    return artifact.payload as T;
  }

  /** Load the internal series context or fail safely. */
  async function requireContext(storyId: string) {
    const context = await seriesRepository.getSeriesContext(storyId);
    if (!context) {
      throw generationFailedError({
        retryable: true,
        internalDetail: `Series context unavailable for ${storyId} (bible not persisted).`,
        stage: "chapter.context",
      });
    }
    return context;
  }

  function seriesInputStoryId(ctx: StageContext): string {
    return (ctx.input as { storyId: string }).storyId;
  }

  async function generateChapterDraft(
    ids: { workflowId: string; stageKey: string; familyId: string },
    dna: StoryDna,
    plan: OneOffPlan,
    recap: unknown,
    prohibited: string[],
    isFirstChapter: boolean,
    pinnedProfile: PinnedRouteProfile,
    mode: "write" | "revise",
    revise?: { priorParagraphs: string[]; reasons: string[] },
  ): Promise<ChapterDraft> {
    const capability: LanguageCapability =
      mode === "write" ? "chapter-writing" : "chapter-revision";
    const planContext = {
      title: plan.title,
      setting: plan.setting,
      emotionalTheme: plan.emotionalTheme,
      protagonistKey: plan.protagonistKey,
      beats: plan.beats,
      climax: plan.climax,
      resolution: plan.resolution,
      calmingClose: plan.calmingClose,
    };
    const outcome = await structuredGenerator.generate<
      ChapterDraftWire,
      ChapterDraft,
      Record<string, unknown>,
      { priorParagraphs?: string[]; revisionReasons?: string[] }
    >({
      capability,
      prompt: (mode === "write"
        ? chapterWritingPrompt
        : chapterRevisionPrompt) as never,
      wireSchema: chapterDraftWireSchema,
      canonicalContext: {
        readingAge: dna.readingAge,
        wordCountTarget: dna.wordCountTarget,
        plan: planContext,
        characters: castOf(dna),
        continuityRecap: recap,
        prohibitedOutcomes: prohibited,
        isFirstChapter,
      },
      untrustedInput:
        mode === "write"
          ? {}
          : {
              priorParagraphs: revise?.priorParagraphs ?? [],
              revisionReasons: revise?.reasons ?? [],
            },
      normalise: normaliseChapterDraft,
      crossReferenceValidate: crossReferenceChapterDraft,
      domainValidate: (d) => validateDraftAgainstPlan(d, plan, dna),
      budget: STEP_BUDGET,
      pinnedProfile,
    });
    return persist({ ...ids, capability }, outcome, "chapter-draft");
  }

  async function generateChapterReview(
    ids: { workflowId: string; stageKey: string; familyId: string },
    dna: StoryDna,
    plan: OneOffPlan,
    paragraphs: string[],
    pinnedProfile: PinnedRouteProfile,
  ): Promise<ReviewArtifact> {
    const outcome = await structuredGenerator.generate<
      ChapterReviewWire,
      ReviewArtifact,
      Record<string, unknown>,
      { paragraphs: string[] }
    >({
      capability: "chapter-review",
      prompt: oneOffReviewPrompt as never,
      wireSchema: chapterReviewWireSchema,
      canonicalContext: {
        readingAge: dna.readingAge,
        suspense: dna.suspense,
        allowMildPeril: dna.allowMildPeril,
        allowDeathGrief: dna.allowDeathGrief,
        prohibitedOutcomes: dna.prohibitedOutcomes,
        planExpectations: {
          title: plan.title,
          resolution: plan.resolution,
          calmingClose: plan.calmingClose,
          beatDescriptions: plan.beats.map((b) => b.description),
        },
        findingCodes: [],
      },
      untrustedInput: { paragraphs },
      normalise: (w): ReviewArtifact => ({
        completeArc: w.completeArc,
        resolvesCentralProblem: w.resolvesCentralProblem,
        endsCalmly: w.endsCalmly,
        sequelDependency: w.sequelDependency,
        ageAppropriate: w.ageAppropriate,
        findings: w.findings,
        summary: w.summary,
      }),
      budget: STEP_BUDGET,
      pinnedProfile,
    });
    return persist(
      { ...ids, capability: "chapter-review" },
      outcome,
      "chapter-review",
    );
  }

  return [
    // 1) CONTEXT — determine the next chapter; guard series completion.
    {
      key: "chapter-context",
      label: "Opening tonight's chapter",
      run: async (ctx: StageContext): Promise<StageResult> => {
        const storyId = seriesInputStoryId(ctx);
        const context = await requireContext(storyId);
        const chapterNumber = context.acceptedChapterCount + 1;
        if (chapterNumber > context.chapterCount) {
          throw new DomainError({
            code: "SERIES_COMPLETE",
            safeMessage: "This series is complete. There are no more chapters.",
            internalDetail: `Chapter ${chapterNumber} requested for a ${context.chapterCount}-chapter series.`,
            retryable: false,
            stage: "chapter.context",
          });
        }
        // Validate the blueprint exists for this chapter.
        blueprintForChapter(context.bible, chapterNumber);
        const output: ChapterContextOutput = {
          chapterNumber,
          isFirstChapter: chapterNumber === 1,
          isFinalChapter: chapterNumber === context.chapterCount,
        };
        return { output: output as unknown as Record<string, unknown> };
      },
    },

    // 2) PLAN — model, validated against the blueprint + continuity.
    {
      key: "chapter-plan",
      label: "Planning tonight's chapter",
      run: async (ctx: StageContext): Promise<StageResult> => {
        const { execution, stageKey } = ctx;
        const storyId = seriesInputStoryId(ctx);
        const context = await requireContext(storyId);
        const { chapterNumber } = (await ctx.getStageOutput(
          "chapter-context",
        )) as ChapterContextOutput;
        const dna = context.storyDna;
        const blueprint = blueprintForChapter(context.bible, chapterNumber);
        const recap = continuitySummary(context.latestSnapshot);

        const outcome = await structuredGenerator.generate<
          ChapterPlanWire,
          OneOffPlan,
          Record<string, unknown>,
          Record<string, never>
        >({
          capability: "chapter-planning",
          prompt: chapterPlanningPrompt as never,
          wireSchema: chapterPlanWireSchema,
          canonicalContext: {
            chapterNumber,
            readingAge: dna.readingAge,
            tone: dna.tone,
            beatTarget: dna.beatTarget,
            worldRules: context.bible.worldRules,
            characters: castOf(dna),
            blueprint: {
              narrativePurpose: blueprint.narrativePurpose,
              openingState: blueprint.openingState,
              localGoal: blueprint.localGoal,
              conflict: blueprint.conflict,
              majorBeats: blueprint.majorBeats,
              emotionalMovement: blueprint.emotionalMovement,
              closingState: blueprint.closingState,
              tomorrowPromise: blueprint.tomorrowPromise,
            },
            continuityRecap: recap,
            prohibitedOutcomes: dna.prohibitedOutcomes,
          },
          untrustedInput: {},
          normalise: normaliseOneOffPlan,
          crossReferenceValidate: (w) => crossReferenceOneOffPlan(w, dna),
          domainValidate: (p) => validateOneOffPlan(p, dna),
          budget: STEP_BUDGET,
          pinnedProfile: context.pinnedRouteProfile,
        });
        const plan = await persist(
          {
            workflowId: execution.id,
            stageKey,
            familyId: execution.familyId,
            capability: "chapter-planning",
          },
          outcome,
          "chapter-plan",
        );
        return { output: { title: plan.title, beatCount: plan.beats.length } };
      },
    },

    // 3) DRAFT — model, deterministic checks.
    {
      key: "chapter-draft",
      label: "Writing tonight's chapter",
      run: async (ctx: StageContext): Promise<StageResult> => {
        const { execution, stageKey } = ctx;
        const storyId = seriesInputStoryId(ctx);
        const context = await requireContext(storyId);
        const { chapterNumber, isFirstChapter } = (await ctx.getStageOutput(
          "chapter-context",
        )) as ChapterContextOutput;
        void chapterNumber;
        const plan = await readArtifact<OneOffPlan>(
          execution.id,
          "chapter-plan",
        );
        const recap = continuitySummary(context.latestSnapshot);

        const draft = await generateChapterDraft(
          {
            workflowId: execution.id,
            stageKey,
            familyId: execution.familyId,
          },
          context.storyDna,
          plan,
          recap,
          context.storyDna.prohibitedOutcomes,
          isFirstChapter,
          context.pinnedRouteProfile,
          "write",
        );
        return {
          output: {
            wordCount: countDraftWords(draft.paragraphs),
            paragraphCount: draft.paragraphs.length,
          },
        };
      },
    },

    // 4) REVIEW — model, advisory.
    {
      key: "chapter-review",
      label: "Checking tonight's chapter",
      run: async (ctx: StageContext): Promise<StageResult> => {
        const { execution, stageKey } = ctx;
        const storyId = seriesInputStoryId(ctx);
        const context = await requireContext(storyId);
        const plan = await readArtifact<OneOffPlan>(
          execution.id,
          "chapter-plan",
        );
        const draft = await readArtifact<ChapterDraft>(
          execution.id,
          "chapter-draft",
        );
        const review = await generateChapterReview(
          {
            workflowId: execution.id,
            stageKey,
            familyId: execution.familyId,
          },
          context.storyDna,
          plan,
          draft.paragraphs,
          context.pinnedRouteProfile,
        );
        return { output: { findingCount: review.findings.length } };
      },
    },

    // 5) FINALISE — APP POLICY + bounded ≤2 revision loop.
    {
      key: "chapter-finalise",
      label: "Checking tonight's chapter",
      run: async (ctx: StageContext): Promise<StageResult> => {
        const { execution, stageKey } = ctx;
        const storyId = seriesInputStoryId(ctx);
        const context = await requireContext(storyId);
        const { chapterNumber, isFirstChapter } = (await ctx.getStageOutput(
          "chapter-context",
        )) as ChapterContextOutput;
        const dna = context.storyDna;
        const plan = await readArtifact<OneOffPlan>(
          execution.id,
          "chapter-plan",
        );
        let draft = await readArtifact<ChapterDraft>(
          execution.id,
          "chapter-draft",
        );
        let review = await readArtifact<ReviewArtifact>(
          execution.id,
          "chapter-review",
        );
        const recap = continuitySummary(context.latestSnapshot);
        const config = {
          maxSuspense: dna.suspense,
          allowMildPeril: dna.allowMildPeril,
          allowDeathGrief: dna.allowDeathGrief,
        };

        let revisionsUsed = 0;
        for (;;) {
          const decision = decideReviewOutcome({
            review,
            config,
            revisionsUsed,
          });

          if (decision.kind === "approve") {
            await generationRunRepository.recordGeneration({
              workflowId: execution.id,
              stageKey,
              familyId: execution.familyId,
              capability: "chapter-writing",
              attempts: [],
              artifact: {
                schemaVersion: chapterDraftWireSchema.schemaVersion,
                kind: "chapter-final",
                payload: {
                  draft,
                  review,
                  decision: decision.kind,
                  revisionsUsed,
                } satisfies ChapterFinalPayload,
              },
            });
            return { output: { decision: "approve", revisionsUsed } };
          }

          if (decision.kind === "block") {
            // First chapter block → the whole series never existed; mark blocked.
            // A later-chapter block leaves published chapters intact (published).
            if (isFirstChapter) {
              await deps.storyRepository.setStoryStatus(
                execution.familyId,
                storyId,
                "blocked",
              );
            }
            throw new DomainError({
              code: "SAFETY_REJECTION",
              safeMessage:
                "This chapter could not be made safe for bedtime, so it was not added. Nothing was saved.",
              internalDetail: `Blocking review findings (chapter ${chapterNumber}): ${decision.reasons.join("; ")}`,
              retryable: false,
              stage: "chapter.finalise",
            });
          }

          if (decision.kind === "fail") {
            if (isFirstChapter) {
              await deps.storyRepository.setStoryStatus(
                execution.familyId,
                storyId,
                "failed",
              );
            }
            throw generationFailedError({
              safeMessage:
                "Tonight's chapter did not come together properly. Nothing was saved, and you can try again.",
              internalDetail: `Unresolved after ${revisionsUsed} revisions (chapter ${chapterNumber}): ${decision.reasons.join("; ")}`,
              retryable: true,
              stage: "chapter.finalise",
            });
          }

          // revise → rewrite, then re-review.
          revisionsUsed += 1;
          draft = await generateChapterDraft(
            {
              workflowId: execution.id,
              stageKey: `${stageKey}:rev${revisionsUsed}:draft`,
              familyId: execution.familyId,
            },
            dna,
            plan,
            recap,
            dna.prohibitedOutcomes,
            isFirstChapter,
            context.pinnedRouteProfile,
            "revise",
            { priorParagraphs: draft.paragraphs, reasons: decision.reasons },
          );
          review = await generateChapterReview(
            {
              workflowId: execution.id,
              stageKey: `${stageKey}:rev${revisionsUsed}:review`,
              familyId: execution.familyId,
            },
            dna,
            plan,
            draft.paragraphs,
            context.pinnedRouteProfile,
          );
        }
      },
    },

    // 6) CONTINUITY — model change set → validate + apply → new snapshot.
    {
      key: "chapter-continuity",
      label: "Remembering what happened",
      run: async (ctx: StageContext): Promise<StageResult> => {
        const { execution, stageKey } = ctx;
        const storyId = seriesInputStoryId(ctx);
        const context = await requireContext(storyId);
        const { chapterNumber } = (await ctx.getStageOutput(
          "chapter-context",
        )) as ChapterContextOutput;
        const final = await readArtifact<ChapterFinalPayload>(
          execution.id,
          "chapter-finalise",
        );
        const previous = context.latestSnapshot;

        const outcome = await structuredGenerator.generate<
          ContinuityChangeWire,
          ContinuityChangeSet,
          Record<string, unknown>,
          { paragraphs: string[] }
        >({
          capability: "continuity-extraction",
          prompt: continuityExtractionPrompt as never,
          wireSchema: continuityChangeWireSchema,
          canonicalContext: {
            chapterNumber,
            characterKeys: Object.keys(previous.characters),
            knownLocationKeys: Object.keys(previous.world.locations),
            openThreadKeys: Object.values(previous.plotThreads)
              .filter((t) => t.status !== "resolved")
              .map((t) => t.threadKey),
            priorContinuityRecap: continuitySummary(previous),
          },
          untrustedInput: { paragraphs: final.draft.paragraphs },
          normalise: normaliseContinuityChange,
          crossReferenceValidate: crossReferenceContinuityChange,
          // Domain-validate by APPLYING against the previous state: a contradiction
          // throws → the pipeline regenerates (continuity favours regeneration).
          domainValidate: (change) =>
            void applyContinuityChanges(previous, change, chapterNumber),
          budget: STEP_BUDGET,
          pinnedProfile: context.pinnedRouteProfile,
        });
        const changeset = await persist(
          {
            workflowId: execution.id,
            stageKey: "chapter-continuity:model",
            familyId: execution.familyId,
            capability: "continuity-extraction",
          },
          outcome,
          "continuity-change",
        );

        const nextState = applyContinuityChanges(
          previous,
          changeset,
          chapterNumber,
        );
        const threadStates = Object.values(nextState.plotThreads).map((t) => ({
          threadKey: t.threadKey,
          status: t.status,
        }));

        await generationRunRepository.recordGeneration({
          workflowId: execution.id,
          stageKey,
          familyId: execution.familyId,
          capability: "continuity-extraction",
          attempts: [],
          artifact: {
            schemaVersion: continuityChangeWireSchema.schemaVersion,
            kind: "continuity-snapshot",
            payload: {
              changeset,
              nextState,
              threadStates,
            } satisfies ContinuityStagePayload,
          },
        });
        return { output: { threadCount: threadStates.length } };
      },
    },

    // 7) ILLUSTRATION PLAN — model; specs only, NO images (M9).
    {
      key: "chapter-illustration",
      label: "Sketching where the pictures go",
      run: async (ctx: StageContext): Promise<StageResult> => {
        const { execution, stageKey } = ctx;
        const storyId = seriesInputStoryId(ctx);
        const context = await requireContext(storyId);
        const final = await readArtifact<ChapterFinalPayload>(
          execution.id,
          "chapter-finalise",
        );
        const draft = final.draft;
        const anchorByKey = new Map(
          draft.anchors.map((a) => [a.key, a.afterParagraph]),
        );

        let specs: (IllustrationSpec & { afterParagraph: number })[] = [];
        if (draft.anchors.length > 0) {
          const outcome = await structuredGenerator.generate<
            IllustrationPlanWire,
            IllustrationSpec[],
            Record<string, unknown>,
            {
              paragraphs: string[];
              anchors: {
                key: string;
                afterParagraph: number;
                description: string;
              }[];
            }
          >({
            capability: "illustration-planning",
            prompt: oneOffIllustrationPrompt as never,
            wireSchema: illustrationPlanWireSchema,
            canonicalContext: {
              tone: context.storyDna.tone,
              maxIllustrations: MAX_ILLUSTRATIONS,
              anchorKeys: draft.anchors.map((a) => a.key),
              characters: castOf(context.storyDna).map((c) => ({
                key: c.key,
                name: c.name,
              })),
            },
            untrustedInput: {
              paragraphs: draft.paragraphs,
              anchors: draft.anchors,
            },
            normalise: normaliseIllustrationPlan,
            crossReferenceValidate: (w) =>
              crossReferenceIllustrationPlan(
                w,
                draft.anchors.map((a) => a.key),
              ),
            budget: STEP_BUDGET,
            pinnedProfile: context.pinnedRouteProfile,
          });
          const planned = await persist(
            {
              workflowId: execution.id,
              stageKey: "chapter-illustration:model",
              familyId: execution.familyId,
              capability: "illustration-planning",
            },
            outcome,
            "illustration-plan",
          );
          specs = planned.map((s) => ({
            ...s,
            afterParagraph: anchorByKey.get(s.anchorKey) ?? 0,
          }));
        }

        await generationRunRepository.recordGeneration({
          workflowId: execution.id,
          stageKey,
          familyId: execution.familyId,
          capability: "illustration-planning",
          attempts: [],
          artifact: {
            schemaVersion: illustrationPlanWireSchema.schemaVersion,
            kind: "illustration-specs",
            payload: { illustrations: specs },
          },
        });
        return { output: { count: specs.length } };
      },
    },

    // 8) PUBLISH — app-code atomic chapter + snapshot publication.
    {
      key: "chapter-publish",
      label: "Adding tonight's chapter",
      run: async (ctx: StageContext): Promise<StageResult> => {
        const { execution } = ctx;
        const storyId = seriesInputStoryId(ctx);
        const context = await requireContext(storyId);
        const { chapterNumber, isFinalChapter } = (await ctx.getStageOutput(
          "chapter-context",
        )) as ChapterContextOutput;
        const plan = await readArtifact<OneOffPlan>(
          execution.id,
          "chapter-plan",
        );
        const final = await readArtifact<ChapterFinalPayload>(
          execution.id,
          "chapter-finalise",
        );
        const continuity = await readArtifact<ContinuityStagePayload>(
          execution.id,
          "chapter-continuity",
        );
        const specsArtifact = await readArtifact<{
          illustrations: (IllustrationSpec & { afterParagraph: number })[];
        }>(execution.id, "chapter-illustration");

        // Every scene shares the series cast for MVP; the protagonist is prominent.
        const subjectCharacterIds = context.storyDna.characters.map(
          (c) => c.id,
        );
        const prominentCharacterId =
          context.storyDna.characters.find((c) => c.key === plan.protagonistKey)
            ?.id ?? null;

        const { chapterId, revisionId } =
          await seriesRepository.publishSeriesChapter({
            familyId: execution.familyId,
            storyId,
            workflowId: execution.id,
            chapterNumber,
            title: final.draft.title,
            plan,
            draftParagraphs: final.draft.paragraphs,
            wordCount: countDraftWords(final.draft.paragraphs),
            schemaVersion: chapterDraftWireSchema.schemaVersion,
            review: {
              review: final.review,
              decision: final.decision as never,
              revisionsUsed: final.revisionsUsed,
            },
            illustrationSpecs: specsArtifact.illustrations.map((s) => ({
              anchorKey: s.anchorKey,
              afterParagraph: s.afterParagraph,
              caption: s.caption,
              sceneDescription: s.sceneDescription,
              aspect: s.aspect,
              schemaVersion: illustrationPlanWireSchema.schemaVersion,
              ...(s.companions ? { companions: s.companions } : {}),
              ...(s.setting ? { setting: s.setting } : {}),
              ...(s.wardrobe ? { wardrobe: s.wardrobe } : {}),
              subjectCharacterIds,
              prominentCharacterId,
            })),
            continuityState: continuity.nextState,
            threadStates: continuity.threadStates,
            isFinalChapter,
          });
        return { output: { chapterId, revisionId, chapterNumber } };
      },
    },

    // 9) DISPATCH — start one image job per spec AFTER the chapter published.
    ...(deps.illustrationRepository && deps.illustrationJobStarter
      ? [
          createDispatchIllustrationsStage(
            {
              illustrationRepository: deps.illustrationRepository,
              illustrationJobStarter: deps.illustrationJobStarter,
            },
            {
              key: "chapter-dispatch-illustrations",
              publishStageKey: "chapter-publish",
              storyIdOf: seriesInputStoryId,
            },
          ),
        ]
      : []),
  ];
}
