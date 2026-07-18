import type { AuthenticatedActor } from "@/domain/actor";
import { nameBasedUuid } from "@/domain/name-uuid";
import { invalidCommandError, unauthorisedError } from "@/lib/errors";
import { authorizeFamilyAction } from "./family-access";
import type { CharacterRepository } from "./ports/character-repository";
import type { FamilyRepository } from "./ports/family-repository";
import type {
  StoryPreferences,
  StoryRepository,
} from "./ports/story-repository";
import {
  CreateOneOffStoryCommandSchema,
  RegenerateChapterCommandSchema,
  RegenerateIllustrationCommandSchema,
  SaveReadingProgressCommandSchema,
  UpdateStoryPreferencesCommandSchema,
} from "./story-schemas";
import type { WorkflowService } from "./workflow-service";
import { CREATE_ONE_OFF_STORY_TYPE } from "./workflows/create-one-off-story-workflow";
import { GENERATE_ILLUSTRATION_TYPE } from "./workflows/generate-illustration-workflow";

/**
 * Story command service (`docs/05-backend/api.md` "Commands":
 * createOneOffStory, updateStoryPreferences, ...). Every mutation resolves the
 * actor's primary family, AUTHORISES the capability, and validates input with Zod
 * BEFORE any repository or workflow runs (`api.md` acceptance criteria). Creating
 * a story is idempotent: the story id is a deterministic function of
 * `(userId, requestId)`, and the workflow is deduped by
 * `UNIQUE(user_id, request_id, workflow_type)`, so a duplicate submission returns
 * the SAME story + workflow (`story-engine.md`: "Duplicate commands return the
 * existing workflow").
 */

export interface StoryCommandDeps {
  familyRepository: FamilyRepository;
  storyRepository: StoryRepository;
  characterRepository: CharacterRepository;
  workflowService: WorkflowService;
}

function requirePrimaryFamily(actor: AuthenticatedActor): string {
  const familyId = actor.familyIds[0];
  if (!familyId) {
    throw unauthorisedError({
      internalDetail: `Actor ${actor.userId} has no family to act in.`,
      stage: "story.family",
    });
  }
  return familyId;
}

export interface CreateOneOffStoryResult {
  storyId: string;
  workflowId: string;
  created: boolean;
}

export function createStoryCommands(deps: StoryCommandDeps) {
  const { familyRepository, storyRepository, characterRepository } = deps;

  return {
    /** Start a durable one-off story workflow, returning the story + workflow handle. */
    async createOneOffStory(
      actor: AuthenticatedActor,
      rawInput: unknown,
    ): Promise<CreateOneOffStoryResult> {
      const command = CreateOneOffStoryCommandSchema.parse(rawInput);
      const familyId = requirePrimaryFamily(actor);
      await authorizeFamilyAction(familyRepository, {
        userId: actor.userId,
        familyId,
        capability: "story:create",
      });

      // Validate the cast: every chosen character must be active in this family.
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
          stage: "story.create",
        });
      }

      // Deterministic story id → idempotent create + a stable entity to poll.
      const storyId = await nameBasedUuid(
        "one-off-story",
        actor.userId,
        command.requestId,
      );
      const generationInput = {
        storyId,
        characterIds: active.map((p) => p.id),
        idea: command.idea,
        theme: command.theme,
        length: command.length,
        tone: command.tone,
      };
      await storyRepository.createStoryIfAbsent({
        id: storyId,
        familyId,
        userId: actor.userId,
        type: "one_off",
        // Store the command so the story can be RE-GENERATED (M9 "Try another wording").
        generationInput,
      });

      const handle = await deps.workflowService.startWorkflow(
        actor,
        CREATE_ONE_OFF_STORY_TYPE,
        command.requestId,
        generationInput,
      );

      return {
        storyId,
        workflowId: handle.workflowId,
        created: handle.created,
      };
    },

    /**
     * Repaint ONE illustration (M9 parent action). Starts a fresh
     * `generate-illustration` job for the spec; on its approval the prior approved
     * illustration revision is retired and a new revision_number is minted
     * (immutable-revision rules preserved). A random request id means each click is
     * a distinct repaint intent (duplicate submit of the same id still dedupes).
     */
    async regenerateIllustration(
      actor: AuthenticatedActor,
      rawInput: unknown,
    ): Promise<{ workflowId: string; created: boolean }> {
      const { specId } = RegenerateIllustrationCommandSchema.parse(rawInput);
      const familyId = requirePrimaryFamily(actor);
      await authorizeFamilyAction(familyRepository, {
        userId: actor.userId,
        familyId,
        capability: "story:create",
      });
      const handle = await deps.workflowService.startWorkflow(
        actor,
        GENERATE_ILLUSTRATION_TYPE,
        `illustration-regen:${specId}:${crypto.randomUUID()}`,
        { specId },
      );
      return { workflowId: handle.workflowId, created: handle.created };
    },

    /**
     * Re-generate a ONE-OFF story's text (M9 parent action "Try another wording").
     * Re-runs the one-off pipeline from the stored generation command and publishes
     * a NEW accepted revision that supersedes the prior one (immutable-revision
     * rules; revision_number increments). A one-off has no continuity chain, so
     * there are no later-chapter dependencies to guard. Series chapters are handled
     * by the series command (which wires `assertRegenerationPreservesDependencies`).
     */
    async regenerateChapter(
      actor: AuthenticatedActor,
      rawInput: unknown,
    ): Promise<{ storyId: string; workflowId: string; created: boolean }> {
      const { storyId } = RegenerateChapterCommandSchema.parse(rawInput);
      const familyId = requirePrimaryFamily(actor);
      await authorizeFamilyAction(familyRepository, {
        userId: actor.userId,
        familyId,
        capability: "story:create",
      });
      const story = await storyRepository.getStory(familyId, storyId);
      if (!story || story.status !== "published" || story.type !== "one_off") {
        throw invalidCommandError({
          safeMessage: "This story can't be re-written right now.",
          internalDetail: `regenerateChapter for non-published/non-one_off story ${storyId}.`,
          stage: "story.regenerate",
        });
      }
      const stored = await storyRepository.getStoryGenerationInput(
        familyId,
        storyId,
      );
      if (!stored || typeof stored !== "object") {
        throw invalidCommandError({
          safeMessage: "This story can't be re-written right now.",
          internalDetail: `No stored generation input for story ${storyId}.`,
          stage: "story.regenerate",
        });
      }
      const handle = await deps.workflowService.startWorkflow(
        actor,
        CREATE_ONE_OFF_STORY_TYPE,
        `one-off-regen:${storyId}:${crypto.randomUUID()}`,
        { ...(stored as Record<string, unknown>), regenerate: true },
      );
      return {
        storyId,
        workflowId: handle.workflowId,
        created: handle.created,
      };
    },

    /** Update the family's parent safety configuration. */
    async updateStoryPreferences(
      actor: AuthenticatedActor,
      rawInput: unknown,
    ): Promise<StoryPreferences> {
      const patch = UpdateStoryPreferencesCommandSchema.parse(rawInput);
      const familyId = requirePrimaryFamily(actor);
      await authorizeFamilyAction(familyRepository, {
        userId: actor.userId,
        familyId,
        capability: "safety:manage",
      });
      return storyRepository.updateStoryPreferences(familyId, patch);
    },

    /** Persist a reader's progress through a story (idempotent per reader). */
    async saveReadingProgress(
      actor: AuthenticatedActor,
      rawInput: unknown,
    ): Promise<void> {
      const command = SaveReadingProgressCommandSchema.parse(rawInput);
      const familyId = requirePrimaryFamily(actor);
      await authorizeFamilyAction(familyRepository, {
        userId: actor.userId,
        familyId,
        capability: "story:read",
      });
      // Resolve the chapter through the reader view — this also guarantees the
      // story is published and family-scoped before we record progress.
      const reader = await storyRepository.getStoryReader(
        familyId,
        actor.userId,
        command.storyId,
      );
      if (!reader) {
        throw invalidCommandError({
          safeMessage: "That story is not available.",
          internalDetail: `No readable story ${command.storyId} for family ${familyId}.`,
          stage: "story.progress",
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

export type StoryCommands = ReturnType<typeof createStoryCommands>;
