import { z } from "zod";

import type { CharacterRepository } from "../ports/character-repository";
import type { GenerationRunRepository } from "../ports/generation-run-repository";
import type { IllustrationRepository } from "../ports/illustration-repository";
import type { IllustrationJobStarter } from "../ports/illustration-job-starter";
import type { StoryRepository } from "../ports/story-repository";
import { createDispatchIllustrationsStage } from "./illustration-dispatch";
import type {
  StageContext,
  StageResult,
  WorkflowDefinition,
} from "../workflow-engine";
import type {
  StructuredGenerationOutcome,
  StructuredGenerator,
} from "../ai/generate-structured";
import { oneOffPlanningPrompt } from "../prompts/one-off-planning.prompt";
import { oneOffWritingPrompt } from "../prompts/one-off-writing.prompt";
import { oneOffRevisionPrompt } from "../prompts/one-off-revision.prompt";
import { oneOffReviewPrompt } from "../prompts/one-off-review.prompt";
import { oneOffIllustrationPrompt } from "../prompts/one-off-illustration.prompt";
import {
  oneOffPlanWireSchema,
  type OneOffPlanWire,
} from "../schemas/one-off-plan.schema";
import {
  chapterDraftWireSchema,
  type ChapterDraftWire,
} from "../schemas/chapter-draft.schema";
import {
  chapterReviewWireSchema,
  type ChapterReviewWire,
} from "../schemas/chapter-review.schema";
import {
  illustrationPlanWireSchema,
  type IllustrationPlanWire,
} from "../schemas/illustration-plan.schema";
import type { LanguageCapability } from "@/domain/model-capability";
import {
  decideReviewOutcome,
  type ReviewArtifact,
} from "@/domain/review-policy";
import { deriveStoryDna, type StoryDna } from "@/domain/story-dna";
import {
  countDraftWords,
  validateDraftAgainstPlan,
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
import { MAX_ILLUSTRATIONS } from "@/domain/story-draft";
import { STORY_LENGTHS, STORY_TONES } from "@/domain/story-dna";
import type { WorkflowBudget } from "@/domain/workflow-budget";
import {
  DomainError,
  generationFailedError,
  invalidCommandError,
} from "@/lib/errors";

/**
 * `create-one-off-story` — the first end-to-end user-facing pipeline
 * (`docs/02-storytelling/story-engine.md` one-off flow; `docs/IMPLEMENTATION_PLAN.md`
 * M7). Deterministic stages on the Lantern Engine:
 *
 *   story-dna (app) → plan (model) → draft (model) → review (model) →
 *   finalise (APP policy + bounded ≤2 revision loop) → illustration-plan (model,
 *   PLAN only) → publish (app-code atomic text publication).
 *
 * Every model output flows the M6 pipeline (parse → wire-validate → normalise →
 * cross-reference → domain-validate → repair ladder) and is recorded to
 * `generation_runs`/`generation_artifacts`. Models NEVER write canonical state:
 * the publication is an app-code transaction consuming validated artifacts. A
 * blocking safety finding fails the workflow with SAFETY_REJECTION and publishes
 * nothing. Every stage is IDEMPOTENT (deterministic ids; recorded artifacts are
 * the resume anchors) per the M5 contract. No images are generated (M9).
 */

export const CREATE_ONE_OFF_STORY_TYPE = "create-one-off-story";

export const CreateOneOffStoryInputSchema = z.object({
  storyId: z.uuid(),
  characterIds: z.array(z.uuid()).min(1).max(6),
  /** The parent's untrusted free-text idea (command metadata, bounded). */
  idea: z.string().min(1).max(500),
  theme: z.string().max(120).nullable().default(null),
  length: z.enum(STORY_LENGTHS),
  tone: z.enum(STORY_TONES),
  /** M9: a regeneration publishes a NEW accepted revision, superseding the prior. */
  regenerate: z.boolean().default(false),
});
export type CreateOneOffStoryInput = z.infer<
  typeof CreateOneOffStoryInputSchema
>;

/**
 * Per-generation budget (`docs/06-engineering/cost-management.md`). Bounds the
 * repair ladder within ONE model stage; the ≤2 revision cap bounds the overall
 * call count across the workflow.
 */
const STEP_BUDGET: WorkflowBudget = {
  maximumTextCalls: 4,
  maximumImageCalls: 0,
  maximumOutputTokens: 20_000,
  maximumEstimatedCostMinorUnits: 8_000,
};

export interface CreateOneOffStoryDeps {
  structuredGenerator: StructuredGenerator;
  generationRunRepository: GenerationRunRepository;
  storyRepository: StoryRepository;
  characterRepository: CharacterRepository;
  /**
   * M9: dispatch per-spec image jobs after the text publication commits. Optional
   * so earlier-only tests need not supply the image stack — when absent the final
   * dispatch stage is simply omitted (the text still publishes with pending slots).
   */
  illustrationRepository?: IllustrationRepository;
  illustrationJobStarter?: IllustrationJobStarter;
}

interface FinalPayload {
  draft: ChapterDraft;
  review: ReviewArtifact;
  decision: string;
  revisionsUsed: number;
}

const ACCEPTED_OUTCOMES = new Set(["accepted", "repaired", "regenerated"]);

export function createCreateOneOffStoryWorkflow(
  deps: CreateOneOffStoryDeps,
): WorkflowDefinition<CreateOneOffStoryInput> {
  const { structuredGenerator, generationRunRepository, storyRepository } =
    deps;

  /** Persist a generation's runs + artifact, then unwrap it or throw its safe error. */
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

  /** Read a previously-recorded validated artifact (resume-safe). */
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
        stage: "one-off.resume",
      });
    }
    return artifact.payload as T;
  }

  function planningContext(dna: StoryDna) {
    return {
      readingAge: dna.readingAge,
      tone: dna.tone,
      suspense: dna.suspense,
      targetReadingMinutes: dna.targetReadingMinutes,
      wordCountTarget: dna.wordCountTarget,
      beatTarget: dna.beatTarget,
      characters: dna.characters.map((c) => ({
        key: c.key,
        name: c.name,
        apparentAge: c.apparentAge,
      })),
      prohibitedOutcomes: dna.prohibitedOutcomes,
      allowMildPeril: dna.allowMildPeril,
      allowDeathGrief: dna.allowDeathGrief,
    };
  }

  function writingContext(dna: StoryDna, plan: OneOffPlan) {
    return {
      readingAge: dna.readingAge,
      wordCountTarget: dna.wordCountTarget,
      plan: {
        title: plan.title,
        setting: plan.setting,
        emotionalTheme: plan.emotionalTheme,
        protagonistKey: plan.protagonistKey,
        beats: plan.beats,
        climax: plan.climax,
        resolution: plan.resolution,
        calmingClose: plan.calmingClose,
      },
      characters: dna.characters.map((c) => ({
        key: c.key,
        name: c.name,
        apparentAge: c.apparentAge,
      })),
      prohibitedOutcomes: dna.prohibitedOutcomes,
    };
  }

  async function generateDraft(
    ids: { workflowId: string; stageKey: string; familyId: string },
    dna: StoryDna,
    plan: OneOffPlan,
    idea: string,
    mode: "write" | "revise",
    revise?: { priorParagraphs: string[]; reasons: string[] },
  ): Promise<ChapterDraft> {
    const capability: LanguageCapability =
      mode === "write" ? "chapter-writing" : "chapter-revision";
    const outcome = await structuredGenerator.generate<
      ChapterDraftWire,
      ChapterDraft,
      ReturnType<typeof writingContext>,
      { idea: string; priorParagraphs?: string[]; revisionReasons?: string[] }
    >({
      capability,
      prompt: (mode === "write"
        ? oneOffWritingPrompt
        : oneOffRevisionPrompt) as never,
      wireSchema: chapterDraftWireSchema,
      canonicalContext: writingContext(dna, plan),
      untrustedInput:
        mode === "write"
          ? { idea }
          : {
              idea,
              priorParagraphs: revise?.priorParagraphs ?? [],
              revisionReasons: revise?.reasons ?? [],
            },
      normalise: normaliseChapterDraft,
      crossReferenceValidate: crossReferenceChapterDraft,
      domainValidate: (d) => validateDraftAgainstPlan(d, plan, dna),
      budget: STEP_BUDGET,
    });
    return persist({ ...ids, capability }, outcome, "chapter-draft");
  }

  async function generateReview(
    ids: { workflowId: string; stageKey: string; familyId: string },
    dna: StoryDna,
    plan: OneOffPlan,
    paragraphs: string[],
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
    });
    return persist(
      { ...ids, capability: "chapter-review" },
      outcome,
      "chapter-review",
    );
  }

  return {
    type: CREATE_ONE_OFF_STORY_TYPE,
    capability: "story:create",
    inputSchema: CreateOneOffStoryInputSchema,
    pendingLabel: "Planning the adventure",
    entityId: (input) => input.storyId,
    stages: [
      // 1) STORY DNA — app code derives the canonical planning spec. No model.
      {
        key: "story-dna",
        label: "Planning the adventure",
        run: async (ctx: StageContext): Promise<StageResult> => {
          const { execution } = ctx;
          const input = ctx.input as CreateOneOffStoryInput;
          const prefs = await storyRepository.ensureStoryPreferences(
            execution.familyId,
          );

          const profiles = await Promise.all(
            input.characterIds.map((id) =>
              deps.characterRepository.getCharacter(execution.familyId, id),
            ),
          );
          const active = profiles.filter(
            (p): p is NonNullable<typeof p> =>
              p != null && p.status === "active",
          );
          if (active.length === 0) {
            throw invalidCommandError({
              safeMessage:
                "Please choose at least one character who is ready to appear.",
              internalDetail: `No active characters among ${input.characterIds.join(", ")}.`,
              stage: "one-off.story-dna",
            });
          }

          const dna = deriveStoryDna({
            length: input.length,
            tone: input.tone,
            characters: active.map((p) => ({
              id: p.id,
              name: p.displayName,
              apparentAge: p.apparentAge,
            })),
            safety: {
              readingAge: prefs.readingAge,
              maxSuspense: prefs.maxSuspense,
              allowMildPeril: prefs.allowMildPeril,
              allowDeathGrief: prefs.allowDeathGrief,
              excludedTopics: prefs.excludedTopics,
            },
          });

          return { output: dna as unknown as Record<string, unknown> };
        },
      },

      // 2) PLAN — model, validated.
      {
        key: "plan",
        label: "Planning the adventure",
        run: async (ctx: StageContext): Promise<StageResult> => {
          const { execution, stageKey } = ctx;
          const input = ctx.input as CreateOneOffStoryInput;
          const dna = (await ctx.getStageOutput("story-dna")) as StoryDna;

          const outcome = await structuredGenerator.generate<
            OneOffPlanWire,
            OneOffPlan,
            ReturnType<typeof planningContext>,
            { idea: string; theme: string | null }
          >({
            capability: "one-off-planning",
            prompt: oneOffPlanningPrompt as never,
            wireSchema: oneOffPlanWireSchema,
            canonicalContext: planningContext(dna),
            untrustedInput: { idea: input.idea, theme: input.theme },
            normalise: normaliseOneOffPlan,
            crossReferenceValidate: (w) => crossReferenceOneOffPlan(w, dna),
            domainValidate: (p) => validateOneOffPlan(p, dna),
            budget: STEP_BUDGET,
          });
          const plan = await persist(
            {
              workflowId: execution.id,
              stageKey,
              familyId: execution.familyId,
              capability: "one-off-planning",
            },
            outcome,
            "one-off-plan",
          );
          return {
            output: { title: plan.title, beatCount: plan.beats.length },
          };
        },
      },

      // 3) DRAFT — model, validated + deterministic draft checks.
      {
        key: "draft",
        label: "Writing tonight's chapter",
        run: async (ctx: StageContext): Promise<StageResult> => {
          const { execution, stageKey } = ctx;
          const input = ctx.input as CreateOneOffStoryInput;
          const dna = (await ctx.getStageOutput("story-dna")) as StoryDna;
          const plan = await readArtifact<OneOffPlan>(execution.id, "plan");

          const draft = await generateDraft(
            {
              workflowId: execution.id,
              stageKey,
              familyId: execution.familyId,
            },
            dna,
            plan,
            input.idea,
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
        key: "review",
        label: "Checking the story",
        run: async (ctx: StageContext): Promise<StageResult> => {
          const { execution, stageKey } = ctx;
          const dna = (await ctx.getStageOutput("story-dna")) as StoryDna;
          const plan = await readArtifact<OneOffPlan>(execution.id, "plan");
          const draft = await readArtifact<ChapterDraft>(execution.id, "draft");

          const review = await generateReview(
            {
              workflowId: execution.id,
              stageKey,
              familyId: execution.familyId,
            },
            dna,
            plan,
            draft.paragraphs,
          );
          return { output: { findingCount: review.findings.length } };
        },
      },

      // 5) FINALISE — APP POLICY + bounded ≤2 revision loop.
      {
        key: "finalise",
        label: "Checking the story",
        run: async (ctx: StageContext): Promise<StageResult> => {
          const { execution, stageKey } = ctx;
          const input = ctx.input as CreateOneOffStoryInput;
          const dna = (await ctx.getStageOutput("story-dna")) as StoryDna;
          const plan = await readArtifact<OneOffPlan>(execution.id, "plan");
          let draft = await readArtifact<ChapterDraft>(execution.id, "draft");
          let review = await readArtifact<ReviewArtifact>(
            execution.id,
            "review",
          );

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
                  kind: "one-off-final",
                  payload: {
                    draft,
                    review,
                    decision: decision.kind,
                    revisionsUsed,
                  } satisfies FinalPayload,
                },
              });
              return { output: { decision: "approve", revisionsUsed } };
            }

            if (decision.kind === "block") {
              // Safety block — never publishable. Mark the story blocked; publish
              // nothing; fail the workflow safely with SAFETY_REJECTION.
              await storyRepository.setStoryStatus(
                execution.familyId,
                input.storyId,
                "blocked",
              );
              throw new DomainError({
                code: "SAFETY_REJECTION",
                safeMessage:
                  "This story could not be made safe for bedtime, so it was not created. Nothing was saved.",
                internalDetail: `Blocking review findings: ${decision.reasons.join("; ")}`,
                retryable: false,
                stage: "one-off.finalise",
              });
            }

            if (decision.kind === "fail") {
              // Non-safety, revisions exhausted — resumable safe retry.
              await storyRepository.setStoryStatus(
                execution.familyId,
                input.storyId,
                "failed",
              );
              throw generationFailedError({
                safeMessage:
                  "This story did not come together properly. Nothing was saved, and you can try again.",
                internalDetail: `Unresolved after ${revisionsUsed} revisions: ${decision.reasons.join("; ")}`,
                retryable: true,
                stage: "one-off.finalise",
              });
            }

            // decision.kind === "revise": rewrite, then re-review.
            revisionsUsed += 1;
            draft = await generateDraft(
              {
                workflowId: execution.id,
                stageKey: `${stageKey}:rev${revisionsUsed}:draft`,
                familyId: execution.familyId,
              },
              dna,
              plan,
              input.idea,
              "revise",
              { priorParagraphs: draft.paragraphs, reasons: decision.reasons },
            );
            review = await generateReview(
              {
                workflowId: execution.id,
                stageKey: `${stageKey}:rev${revisionsUsed}:review`,
                familyId: execution.familyId,
              },
              dna,
              plan,
              draft.paragraphs,
            );
          }
        },
      },

      // 6) ILLUSTRATION PLAN — model; specs only, NO images (M9).
      {
        key: "illustration-plan",
        label: "Sketching where the pictures go",
        run: async (ctx: StageContext): Promise<StageResult> => {
          const { execution, stageKey } = ctx;
          const dna = (await ctx.getStageOutput("story-dna")) as StoryDna;
          const final = await readArtifact<FinalPayload>(
            execution.id,
            "finalise",
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
                tone: dna.tone,
                maxIllustrations: MAX_ILLUSTRATIONS,
                anchorKeys: draft.anchors.map((a) => a.key),
                characters: dna.characters.map((c) => ({
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
            });
            const planned = await persist(
              {
                workflowId: execution.id,
                stageKey: "illustration-plan:model",
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

          // Record the enriched specs artifact the publish stage consumes
          // (always present, even with zero illustrations).
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

      // 7) PUBLISH — app-code atomic text publication. Dispatch nothing image-y.
      {
        key: "publish",
        label: "Getting the book ready",
        run: async (ctx: StageContext): Promise<StageResult> => {
          const { execution } = ctx;
          const input = ctx.input as CreateOneOffStoryInput;
          const dna = (await ctx.getStageOutput("story-dna")) as StoryDna;
          const plan = await readArtifact<OneOffPlan>(execution.id, "plan");
          const final = await readArtifact<FinalPayload>(
            execution.id,
            "finalise",
          );
          const specsArtifact = await readArtifact<{
            illustrations: (IllustrationSpec & { afterParagraph: number })[];
          }>(execution.id, "illustration-plan");

          // Every scene shares the story cast for MVP; the protagonist is prominent.
          const subjectCharacterIds = dna.characters.map((c) => c.id);
          const prominentCharacterId =
            dna.characters.find((c) => c.key === plan.protagonistKey)?.id ??
            null;

          const { chapterId, revisionId } =
            await storyRepository.publishOneOffChapter({
              familyId: execution.familyId,
              storyId: input.storyId,
              workflowId: execution.id,
              title: final.draft.title,
              plan,
              draftParagraphs: final.draft.paragraphs,
              wordCount: countDraftWords(final.draft.paragraphs),
              schemaVersion: chapterDraftWireSchema.schemaVersion,
              regenerate: input.regenerate,
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
                subjectCharacterIds,
                prominentCharacterId,
              })),
            });
          return { output: { chapterId, revisionId } };
        },
      },

      // 8) DISPATCH — start one image job per spec AFTER the publish committed.
      ...(deps.illustrationRepository && deps.illustrationJobStarter
        ? [
            createDispatchIllustrationsStage(
              {
                illustrationRepository: deps.illustrationRepository,
                illustrationJobStarter: deps.illustrationJobStarter,
              },
              {
                key: "dispatch-illustrations",
                publishStageKey: "publish",
                storyIdOf: (ctx) =>
                  (ctx.input as CreateOneOffStoryInput).storyId,
              },
            ),
          ]
        : []),
    ],
  };
}
