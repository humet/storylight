import type { AuthenticatedActor } from "@/domain/actor";
import { nameBasedUuid } from "@/domain/name-uuid";
import {
  DomainError,
  invalidCommandError,
  unauthorisedError,
} from "@/lib/errors";
import { authorizeFamilyAction } from "./family-access";
import type { CharacterRepository } from "./ports/character-repository";
import type { FamilyRepository } from "./ports/family-repository";
import type { SeriesRepository } from "./ports/series-repository";
import type { StoryRepository } from "./ports/story-repository";
import {
  ContinueSeriesCommandSchema,
  CreateSeriesCommandSchema,
  SaveSeriesProgressCommandSchema,
} from "./series-schemas";
import type { WorkflowService } from "./workflow-service";
import { CREATE_SERIES_TYPE } from "./workflows/create-series-workflow";
import { GENERATE_NEXT_CHAPTER_TYPE } from "./workflows/generate-next-chapter-workflow";

/**
 * SERIES command service (`docs/05-backend/api.md`). Creating a series is
 * idempotent: the story id is a deterministic function of `(userId, requestId)`,
 * and the workflow dedupes on `UNIQUE(user_id, request_id, workflow_type)`.
 *
 * `continueSeries` is the ADVISORY CHAPTER LOCK: it derives a DETERMINISTIC
 * requestId per `(series, target chapter)`, so two concurrent "Continue tonight"
 * taps collapse to ONE next-chapter workflow — only one workflow ever generates a
 * given chapter number (`story-series.md`).
 */

export interface SeriesCommandDeps {
  familyRepository: FamilyRepository;
  storyRepository: StoryRepository;
  seriesRepository: SeriesRepository;
  characterRepository: CharacterRepository;
  workflowService: WorkflowService;
}

function requirePrimaryFamily(actor: AuthenticatedActor): string {
  const familyId = actor.familyIds[0];
  if (!familyId) {
    throw unauthorisedError({
      internalDetail: `Actor ${actor.userId} has no family to act in.`,
      stage: "series.family",
    });
  }
  return familyId;
}

export interface CreateSeriesResult {
  storyId: string;
  workflowId: string;
  created: boolean;
}

export interface ContinueSeriesResult {
  storyId: string;
  workflowId: string;
  chapterNumber: number;
  created: boolean;
}

export function createSeriesCommands(deps: SeriesCommandDeps) {
  const {
    familyRepository,
    storyRepository,
    seriesRepository,
    characterRepository,
  } = deps;

  return {
    /** Start a durable create-series workflow (bible → pin → Chapter 1). */
    async createSeries(
      actor: AuthenticatedActor,
      rawInput: unknown,
    ): Promise<CreateSeriesResult> {
      const command = CreateSeriesCommandSchema.parse(rawInput);
      const familyId = requirePrimaryFamily(actor);
      await authorizeFamilyAction(familyRepository, {
        userId: actor.userId,
        familyId,
        capability: "story:create",
      });

      const profiles = await Promise.all(
        command.characterIds.map((id) =>
          characterRepository.getCharacter(familyId, id),
        ),
      );
      const active = profiles.filter(
        (p): p is NonNullable<typeof p> => p != null && p.status === "active",
      );
      if (active.length === 0) {
        throw invalidCommandError({
          safeMessage: "Please choose at least one character who is ready.",
          internalDetail: `No active characters among ${command.characterIds.join(", ")}.`,
          stage: "series.create",
        });
      }

      const storyId = await nameBasedUuid(
        "series-story",
        actor.userId,
        command.requestId,
      );
      await storyRepository.createStoryIfAbsent({
        id: storyId,
        familyId,
        userId: actor.userId,
        type: "series",
      });

      const handle = await deps.workflowService.startWorkflow(
        actor,
        CREATE_SERIES_TYPE,
        command.requestId,
        {
          storyId,
          characterIds: active.map((p) => p.id),
          idea: command.idea,
          theme: command.theme,
          length: command.length,
          tone: command.tone,
          chapterCount: command.chapterCount,
        },
      );

      return {
        storyId,
        workflowId: handle.workflowId,
        created: handle.created,
      };
    },

    /** Generate the next chapter of a series. Concurrent taps collapse to one. */
    async continueSeries(
      actor: AuthenticatedActor,
      rawInput: unknown,
    ): Promise<ContinueSeriesResult> {
      const command = ContinueSeriesCommandSchema.parse(rawInput);
      const familyId = requirePrimaryFamily(actor);
      await authorizeFamilyAction(familyRepository, {
        userId: actor.userId,
        familyId,
        capability: "story:create",
      });

      const overview = await seriesRepository.getSeriesReaderOverview(
        familyId,
        command.storyId,
      );
      if (!overview) {
        throw invalidCommandError({
          safeMessage: "That series is not available.",
          internalDetail: `No readable series ${command.storyId} for family ${familyId}.`,
          stage: "series.continue",
        });
      }
      if (overview.nextChapterNumber === null) {
        throw new DomainError({
          code: "SERIES_COMPLETE",
          safeMessage: "This series is complete. There are no more chapters.",
          internalDetail: `Series ${command.storyId} already has all ${overview.chapterCount} chapters.`,
          retryable: false,
          stage: "series.continue",
        });
      }

      // DETERMINISTIC requestId per (series, target chapter) — the advisory lock:
      // concurrent taps by the SAME user dedupe on UNIQUE(user_id, request_id,
      // workflow_type). It is intentionally NOT user-scoped in the string: the
      // uniqueness is already per-user, so a DIFFERENT family member can legitimately
      // start their own workflow to continue a run another member's workflow left
      // failed. A cross-user race to publish the SAME chapter is made safe at the
      // publish layer — `publishSeriesChapter` is first-writer-wins and the loser is
      // a clean no-op (it writes no revision-scoped content), so it can never pollute
      // the winner's immutable revision.
      const requestId = `series-next:${command.storyId}:${overview.nextChapterNumber}`;
      const handle = await deps.workflowService.startWorkflow(
        actor,
        GENERATE_NEXT_CHAPTER_TYPE,
        requestId,
        { storyId: command.storyId },
      );

      return {
        storyId: command.storyId,
        workflowId: handle.workflowId,
        chapterNumber: overview.nextChapterNumber,
        created: handle.created,
      };
    },

    /** Persist a reader's progress through a specific series chapter. */
    async saveSeriesProgress(
      actor: AuthenticatedActor,
      rawInput: unknown,
    ): Promise<void> {
      const command = SaveSeriesProgressCommandSchema.parse(rawInput);
      const familyId = requirePrimaryFamily(actor);
      await authorizeFamilyAction(familyRepository, {
        userId: actor.userId,
        familyId,
        capability: "story:read",
      });
      const reader = await seriesRepository.getSeriesChapterReader(
        familyId,
        actor.userId,
        command.storyId,
        command.chapterNumber,
      );
      if (!reader) {
        throw invalidCommandError({
          safeMessage: "That chapter is not available.",
          internalDetail: `No readable chapter ${command.chapterNumber} of series ${command.storyId}.`,
          stage: "series.progress",
        });
      }
      await storyRepository.saveReadingProgress({
        familyId,
        userId: actor.userId,
        storyId: command.storyId,
        chapterId: reader.chapterId,
        scrollProportion: command.scrollProportion,
        paragraphAnchor: command.paragraphAnchor,
        completed: command.completed,
      });
    },
  };
}

export type SeriesCommands = ReturnType<typeof createSeriesCommands>;
