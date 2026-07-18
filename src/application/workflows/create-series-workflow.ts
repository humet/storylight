import { z } from "zod";

import type { CharacterRepository } from "../ports/character-repository";
import type { GenerationRunRepository } from "../ports/generation-run-repository";
import type { ModelRouteRepository } from "../ports/model-route-repository";
import type { SeriesRepository } from "../ports/series-repository";
import type { StoryRepository } from "../ports/story-repository";
import type {
  StageContext,
  StageResult,
  WorkflowDefinition,
} from "../workflow-engine";
import type { StructuredGenerator } from "../ai/generate-structured";
import { seriesPlanningPrompt } from "../prompts/series-planning.prompt";
import { chapterPlanningPrompt } from "../prompts/chapter-planning.prompt";
import { chapterWritingPrompt } from "../prompts/chapter-writing.prompt";
import { chapterRevisionPrompt } from "../prompts/chapter-revision.prompt";
import { oneOffReviewPrompt } from "../prompts/one-off-review.prompt";
import { oneOffIllustrationPrompt } from "../prompts/one-off-illustration.prompt";
import { continuityExtractionPrompt } from "../prompts/continuity-extraction.prompt";
import {
  seriesBibleWireSchema,
  type SeriesBibleWire,
} from "../schemas/series-bible.schema";
import { chapterPlanWireSchema } from "../schemas/chapter-plan.schema";
import { chapterDraftWireSchema } from "../schemas/chapter-draft.schema";
import { chapterReviewWireSchema } from "../schemas/chapter-review.schema";
import { continuityChangeWireSchema } from "../schemas/continuity-change.schema";
import { illustrationPlanWireSchema } from "../schemas/illustration-plan.schema";
import type { LanguageCapability } from "@/domain/model-capability";
import type { PinnedRouteProfile } from "@/domain/model-route";
import { createInitialContinuityState } from "@/domain/continuity";
import {
  crossReferenceSeriesBible,
  normaliseSeriesBible,
  validateSeriesBible,
  type SeriesBible,
} from "@/domain/series-bible";
import {
  deriveStoryDna,
  STORY_LENGTHS,
  STORY_TONES,
  type StoryDna,
} from "@/domain/story-dna";
import type { WorkflowBudget } from "@/domain/workflow-budget";
import { invalidCommandError } from "@/lib/errors";
import { createChapterStages, type ChapterStagesDeps } from "./chapter-stages";

/**
 * `create-series` — plan a COMPLETE series bible, validate + persist it, PIN the
 * versions, then generate Chapter 1 (`docs/02-storytelling/story-series.md`
 * "Series creation"; domain rule 1: series planned completely before Chapter 1).
 *
 * Stages: series-dna (app) → series-bible (model, structural+semantic validated) →
 * persist-bible (app: persist accepted bible + blueprints + threads + initial
 * snapshot; PIN model-route / prompt / schema / visual-profile versions) → the
 * SHARED chapter stages, which for acceptedChapterCount=0 target Chapter 1.
 */

export const CREATE_SERIES_TYPE = "create-series";

export const CreateSeriesInputSchema = z.object({
  storyId: z.uuid(),
  characterIds: z.array(z.uuid()).min(1).max(6),
  idea: z.string().min(1).max(500),
  theme: z.string().max(120).nullable().default(null),
  length: z.enum(STORY_LENGTHS),
  tone: z.enum(STORY_TONES),
  /** MVP series lengths (`story-series.md` "Chapter count"). */
  chapterCount: z.union([z.literal(5), z.literal(10)]),
});
export type CreateSeriesInput = z.infer<typeof CreateSeriesInputSchema>;

const SERIES_BIBLE_BUDGET: WorkflowBudget = {
  maximumTextCalls: 4,
  maximumImageCalls: 0,
  maximumOutputTokens: 40_000,
  maximumEstimatedCostMinorUnits: 20_000,
};

/** The language capabilities a series pins at creation (domain rule 8). */
const PINNED_CAPABILITIES: LanguageCapability[] = [
  "series-planning",
  "chapter-planning",
  "chapter-writing",
  "chapter-review",
  "chapter-revision",
  "continuity-extraction",
  "illustration-planning",
];

const PINNED_SCHEMA_VERSIONS = [
  seriesBibleWireSchema.schemaVersion,
  chapterPlanWireSchema.schemaVersion,
  chapterDraftWireSchema.schemaVersion,
  chapterReviewWireSchema.schemaVersion,
  continuityChangeWireSchema.schemaVersion,
  illustrationPlanWireSchema.schemaVersion,
];

function pinnedPromptVersions(): Record<string, string> {
  return Object.fromEntries(
    [
      seriesPlanningPrompt,
      chapterPlanningPrompt,
      chapterWritingPrompt,
      chapterRevisionPrompt,
      oneOffReviewPrompt,
      continuityExtractionPrompt,
      oneOffIllustrationPrompt,
    ].map((p) => [p.purpose, p.version]),
  );
}

export interface CreateSeriesDeps extends ChapterStagesDeps {
  structuredGenerator: StructuredGenerator;
  generationRunRepository: GenerationRunRepository;
  seriesRepository: SeriesRepository;
  storyRepository: StoryRepository;
  characterRepository: CharacterRepository;
  modelRouteRepository: ModelRouteRepository;
}

export function createCreateSeriesWorkflow(
  deps: CreateSeriesDeps,
): WorkflowDefinition<CreateSeriesInput> {
  const {
    structuredGenerator,
    generationRunRepository,
    seriesRepository,
    storyRepository,
    characterRepository,
    modelRouteRepository,
  } = deps;

  return {
    type: CREATE_SERIES_TYPE,
    capability: "story:create",
    inputSchema: CreateSeriesInputSchema,
    pendingLabel: "Dreaming up the whole adventure",
    entityId: (input) => input.storyId,
    stages: [
      // 1) STORY DNA — the fixed series DNA (app; no model).
      {
        key: "series-dna",
        label: "Dreaming up the whole adventure",
        run: async (ctx: StageContext): Promise<StageResult> => {
          const { execution } = ctx;
          const input = ctx.input as CreateSeriesInput;
          const prefs = await storyRepository.ensureStoryPreferences(
            execution.familyId,
          );
          const profiles = await Promise.all(
            input.characterIds.map((id) =>
              characterRepository.getCharacter(execution.familyId, id),
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
              stage: "series.dna",
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

      // 2) SERIES BIBLE — model; structural + semantic validation.
      {
        key: "series-bible",
        label: "Planning every chapter",
        run: async (ctx: StageContext): Promise<StageResult> => {
          const { execution, stageKey } = ctx;
          const input = ctx.input as CreateSeriesInput;
          const dna = (await ctx.getStageOutput("series-dna")) as StoryDna;

          const outcome = await structuredGenerator.generate<
            SeriesBibleWire,
            SeriesBible,
            Record<string, unknown>,
            { idea: string; theme: string | null }
          >({
            capability: "series-planning",
            prompt: seriesPlanningPrompt as never,
            wireSchema: seriesBibleWireSchema,
            canonicalContext: {
              readingAge: dna.readingAge,
              tone: dna.tone,
              suspense: dna.suspense,
              chapterCount: input.chapterCount,
              characters: dna.characters.map((c) => ({
                key: c.key,
                name: c.name,
                apparentAge: c.apparentAge,
              })),
              prohibitedOutcomes: dna.prohibitedOutcomes,
              allowMildPeril: dna.allowMildPeril,
              allowDeathGrief: dna.allowDeathGrief,
            },
            untrustedInput: { idea: input.idea, theme: input.theme },
            normalise: (w) => normaliseSeriesBible(w, input.chapterCount),
            crossReferenceValidate: (w) => crossReferenceSeriesBible(w, dna),
            domainValidate: (bible) => validateSeriesBible(bible),
            budget: SERIES_BIBLE_BUDGET,
          });

          const acceptedAttemptIndex = outcome.ok
            ? outcome.attempts.find((a) =>
                ["accepted", "repaired", "regenerated"].includes(a.outcome),
              )?.attemptIndex
            : undefined;
          await generationRunRepository.recordGeneration({
            workflowId: execution.id,
            stageKey,
            familyId: execution.familyId,
            capability: "series-planning",
            attempts: outcome.attempts,
            artifact: outcome.ok
              ? {
                  schemaVersion: outcome.schemaVersion,
                  kind: "series-bible",
                  payload: outcome.artifact,
                }
              : undefined,
            acceptedAttemptIndex,
          });
          if (!outcome.ok) throw outcome.error;
          return {
            output: {
              title: outcome.artifact.title,
              chapterCount: outcome.artifact.chapterCount,
            },
          };
        },
      },

      // 3) PERSIST BIBLE — app; persist + PIN versions + seed continuity.
      {
        key: "persist-bible",
        label: "Setting up your series",
        run: async (ctx: StageContext): Promise<StageResult> => {
          const { execution } = ctx;
          const input = ctx.input as CreateSeriesInput;
          const dna = (await ctx.getStageOutput("series-dna")) as StoryDna;
          const artifact = await generationRunRepository.getArtifact(
            execution.id,
            "series-bible",
          );
          if (!artifact) {
            throw invalidCommandError({
              internalDetail: `Missing series-bible artifact for ${execution.id}.`,
              stage: "series.persist",
            });
          }
          const bible = artifact.payload as SeriesBible;

          // PIN the ACTIVE route version per capability (domain rule 8).
          const pinnedRouteProfile: PinnedRouteProfile = {};
          for (const capability of PINNED_CAPABILITIES) {
            const active =
              await modelRouteRepository.getActiveRoute(capability);
            if (active) pinnedRouteProfile[capability] = active.id;
          }

          // PIN the current approved visual-profile version per character.
          const pinnedVisualProfiles: Record<string, string> = {};
          for (const id of input.characterIds) {
            const character = await characterRepository.getCharacter(
              execution.familyId,
              id,
            );
            if (character?.visualProfileId) {
              pinnedVisualProfiles[id] = character.visualProfileId;
            }
          }

          const initialContinuity = createInitialContinuityState({
            seriesId: input.storyId,
            characterKeys: dna.characters.map((c) => c.key),
            startingLocationId: bible.startingLocationKey,
            startingTime: "evening",
            knownLocationIds: bible.locations.map((l) => l.key),
            immutableFacts: bible.immutableFacts.map((f) => ({
              factKey: f.factKey,
              statement: f.statement,
            })),
          });

          await seriesRepository.persistSeriesBible({
            familyId: execution.familyId,
            storyId: input.storyId,
            workflowId: execution.id,
            schemaVersion: seriesBibleWireSchema.schemaVersion,
            bible,
            storyDna: dna,
            pinnedRouteProfile,
            pinnedPromptVersions: pinnedPromptVersions(),
            pinnedSchemaVersions: PINNED_SCHEMA_VERSIONS,
            pinnedVisualProfiles,
            initialContinuity,
          });
          return { output: { pinnedCapabilities: PINNED_CAPABILITIES.length } };
        },
      },

      // 4..11) The shared chapter stages — Chapter 1 for a new series.
      ...createChapterStages({
        structuredGenerator,
        generationRunRepository,
        seriesRepository,
        storyRepository,
        characterRepository,
      }),
    ],
  };
}
