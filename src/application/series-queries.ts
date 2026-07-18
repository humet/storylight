import type { AuthenticatedActor } from "@/domain/actor";
import type { FamilyCapability } from "@/domain/authorization";
import { unauthorisedError } from "@/lib/errors";
import { authorizeFamilyAction } from "./family-access";
import type { FamilyRepository } from "./ports/family-repository";
import type {
  SeriesChapterReaderView,
  SeriesReaderOverview,
  SeriesRepository,
} from "./ports/series-repository";

/**
 * SERIES query service (`docs/05-backend/api.md`). Reads authorise on the actor's
 * family and return SPOILER-FREE read models only — the overview never carries the
 * bible, internal synopsis, or future blueprints, and the chapter reader returns
 * accepted/published content only (domain rule 9; `story-series.md` "Spoilers"),
 * enforced in the repository query and proven by tests.
 */

export interface SeriesQueryDeps {
  familyRepository: FamilyRepository;
  seriesRepository: SeriesRepository;
}

function requirePrimaryFamily(actor: AuthenticatedActor): string {
  const familyId = actor.familyIds[0];
  if (!familyId) {
    throw unauthorisedError({
      internalDetail: `Actor ${actor.userId} has no family to read.`,
      stage: "series.family",
    });
  }
  return familyId;
}

export function createSeriesQueries(deps: SeriesQueryDeps) {
  const { familyRepository, seriesRepository } = deps;

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
    /** Spoiler-free series overview (progress + published chapter list). */
    async getSeriesOverview(
      actor: AuthenticatedActor,
      storyId: string,
    ): Promise<SeriesReaderOverview | null> {
      const familyId = await authorise(actor, "story:read");
      return seriesRepository.getSeriesReaderOverview(familyId, storyId);
    },

    /** A single accepted/published chapter for the reader, or null. */
    async getSeriesChapter(
      actor: AuthenticatedActor,
      storyId: string,
      chapterNumber: number,
    ): Promise<SeriesChapterReaderView | null> {
      const familyId = await authorise(actor, "story:read");
      return seriesRepository.getSeriesChapterReader(
        familyId,
        actor.userId,
        storyId,
        chapterNumber,
      );
    },
  };
}

export type SeriesQueries = ReturnType<typeof createSeriesQueries>;
