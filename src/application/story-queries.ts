import type { AuthenticatedActor } from "@/domain/actor";
import type { CharacterSummary } from "@/domain/character";
import { unauthorisedError } from "@/lib/errors";
import type { FamilyCapability } from "@/domain/authorization";
import { authorizeFamilyAction } from "./family-access";
import type { CharacterRepository } from "./ports/character-repository";
import type { FamilyRepository } from "./ports/family-repository";
import type {
  StoryLifecycleStatus,
  StoryPreferences,
  StoryReaderView,
  StoryRepository,
  StorySummary,
} from "./ports/story-repository";

/**
 * Story query service (`docs/05-backend/api.md` "Queries": getHome, getLibrary,
 * getStoryReader, getParentSettings). Reads authorise on the actor's family and
 * return PURPOSE-BUILT read models. The reader read model contains ONLY accepted,
 * published content — no rejected revisions, hidden plans, prompts, or provider
 * metadata (`api.md` "Reader API"; domain rule 9), enforced in the repository
 * query and proven by tests.
 */

export interface StoryHomeView {
  /** The most recent published story to continue, if any. */
  continueStory: StorySummary | null;
  /** Recent stories for the library preview (published + in-progress). */
  recentStories: StorySummary[];
  hasActiveCharacters: boolean;
}

export interface StoryQueryDeps {
  familyRepository: FamilyRepository;
  storyRepository: StoryRepository;
  characterRepository: CharacterRepository;
}

function requirePrimaryFamily(actor: AuthenticatedActor): string {
  const familyId = actor.familyIds[0];
  if (!familyId) {
    throw unauthorisedError({
      internalDetail: `Actor ${actor.userId} has no family to read.`,
      stage: "story.family",
    });
  }
  return familyId;
}

export function createStoryQueries(deps: StoryQueryDeps) {
  const { familyRepository, storyRepository, characterRepository } = deps;

  async function authorise(
    actor: AuthenticatedActor,
    capability: FamilyCapability,
  ): Promise<string> {
    const familyId = requirePrimaryFamily(actor);
    await authorizeFamilyAction(familyRepository, {
      userId: actor.userId,
      familyId,
      capability,
    });
    return familyId;
  }

  return {
    /** The reader payload — accepted/published content only, or null. */
    async getStoryReader(
      actor: AuthenticatedActor,
      storyId: string,
    ): Promise<StoryReaderView | null> {
      const familyId = await authorise(actor, "story:read");
      return storyRepository.getStoryReader(familyId, actor.userId, storyId);
    },

    /** A story's lifecycle status (for the reader's not-ready branching). */
    async getStoryStatus(
      actor: AuthenticatedActor,
      storyId: string,
    ): Promise<StoryLifecycleStatus | null> {
      const familyId = await authorise(actor, "story:read");
      const story = await storyRepository.getStory(familyId, storyId);
      return story?.status ?? null;
    },

    /** The family's stories for the library (never blocked/failed). */
    async getLibrary(actor: AuthenticatedActor): Promise<StorySummary[]> {
      const familyId = await authorise(actor, "story:read");
      return storyRepository.listLibrary(familyId);
    },

    /** The home read model: continue + recent + whether a cast exists yet. */
    async getHome(actor: AuthenticatedActor): Promise<StoryHomeView> {
      const familyId = await authorise(actor, "story:read");
      const [stories, characters] = await Promise.all([
        storyRepository.listLibrary(familyId),
        characterRepository.listCharacters(familyId),
      ]);
      const published = stories.filter((s) => s.status === "published");
      return {
        continueStory: published[0] ?? null,
        recentStories: stories.slice(0, 6),
        hasActiveCharacters: characters.some((c) => c.status === "active"),
      };
    },

    /** Active characters for the create-flow picker. */
    async getActiveCharacters(
      actor: AuthenticatedActor,
    ): Promise<CharacterSummary[]> {
      const familyId = await authorise(actor, "story:create");
      const all = await characterRepository.listCharacters(familyId);
      return all
        .filter((c) => c.status === "active")
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
    },

    /** The family's parent safety configuration (defaults when unset). */
    async getStoryPreferences(
      actor: AuthenticatedActor,
    ): Promise<StoryPreferences> {
      const familyId = await authorise(actor, "safety:manage");
      return storyRepository.getStoryPreferences(familyId);
    },
  };
}

export type StoryQueries = ReturnType<typeof createStoryQueries>;
