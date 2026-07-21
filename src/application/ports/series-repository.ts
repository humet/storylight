import type { ContinuityState, PlotThreadStatus } from "@/domain/continuity";
import type { PinnedRouteProfile } from "@/domain/model-route";
import type {
  ReviewArtifact,
  ReviewDecisionKind,
} from "@/domain/review-policy";
import type { SeriesBible } from "@/domain/series-bible";
import type { StoryDna } from "@/domain/story-dna";
import type { OneOffPlan } from "@/domain/story-draft";
import type { SceneCompanion, SceneSetting } from "@/domain/image-request";
import type { ReadingProgress } from "./story-repository";

/**
 * SERIES persistence PORT — owned by the application (domain rule 12). Holds the
 * spoiler-bearing accepted bible + pins, the per-chapter blueprints, the immutable
 * continuity snapshot chain, and the plot-thread lifecycle. The Drizzle impl lives
 * in `src/db/repositories/series-repository.ts`.
 *
 * SPOILER RULE (`story-series.md`): only {@link getSeriesReaderOverview} and
 * {@link getSeriesChapterReader} are child-facing, and they return ONLY the
 * spoiler-free premise + accepted/published chapter content — never the bible,
 * internal synopsis, future blueprints, plot threads, or pins.
 */

export interface PersistSeriesBibleInput {
  familyId: string;
  storyId: string;
  /** For deterministic (idempotent) ids across a stage re-run. */
  workflowId: string;
  schemaVersion: string;
  bible: SeriesBible;
  /** The fixed Story DNA for the whole series. */
  storyDna: StoryDna;
  /** Pinned versions at creation (domain rule 8). */
  pinnedRouteProfile: PinnedRouteProfile;
  pinnedPromptVersions: Record<string, string>;
  pinnedSchemaVersions: string[];
  pinnedVisualProfiles: Record<string, string>;
  /** The initial (afterChapter 0) continuity snapshot to seed the chain. */
  initialContinuity: ContinuityState;
  now?: Date;
}

/** The internal series context a chapter workflow builds from (spoiler-bearing). */
export interface SeriesContext {
  storyId: string;
  bible: SeriesBible;
  storyDna: StoryDna;
  pinnedRouteProfile: PinnedRouteProfile;
  pinnedPromptVersions: Record<string, string>;
  chapterCount: number;
  /** How many chapters already have an accepted revision. */
  acceptedChapterCount: number;
  /** The latest accepted continuity snapshot (afterChapter = acceptedChapterCount). */
  latestSnapshot: ContinuityState;
}

export interface PublishSeriesChapterInput {
  familyId: string;
  storyId: string;
  workflowId: string;
  chapterNumber: number;
  title: string;
  plan: OneOffPlan;
  draftParagraphs: string[];
  wordCount: number;
  schemaVersion: string;
  review: {
    review: ReviewArtifact;
    decision: ReviewDecisionKind;
    revisionsUsed: number;
  };
  illustrationSpecs: {
    anchorKey: string;
    afterParagraph: number;
    caption: string;
    sceneDescription: string;
    aspect: "portrait" | "landscape" | "square";
    schemaVersion: string;
    /** Recurring non-child companions for this scene (ADR-008 part 3). */
    companions?: SceneCompanion[];
    /** Canonical setting + time-of-day (ADR-008 part 4), if declared. */
    setting?: SceneSetting;
    /** DB character ids of the children in this scene (drives reference selection). */
    subjectCharacterIds: string[];
    /** The most prominent child's DB id, if any. */
    prominentCharacterId: string | null;
  }[];
  /** The NEW immutable snapshot (afterChapter = chapterNumber). */
  continuityState: ContinuityState;
  /** Plot-thread statuses after this chapter. */
  threadStates: { threadKey: string; status: PlotThreadStatus }[];
  /** True when this is the final chapter of the planned series. */
  isFinalChapter: boolean;
  now?: Date;
}

// --- Reader read models (child-facing, spoiler-free) --------------------

export interface SeriesChapterSummary {
  chapterNumber: number;
  title: string;
  published: boolean;
}

export interface SeriesReaderOverview {
  storyId: string;
  title: string;
  /** Spoiler-free premise only (never the internal synopsis or bible). */
  premise: string;
  chapterCount: number;
  chapters: SeriesChapterSummary[];
  publishedChapterCount: number;
  /** The next chapter to generate (null when the series is complete). */
  nextChapterNumber: number | null;
  isComplete: boolean;
}

export interface SeriesChapterReaderView {
  storyId: string;
  chapterId: string;
  chapterNumber: number;
  chapterCount: number;
  title: string;
  paragraphs: string[];
  illustrations: {
    specId: string;
    anchorKey: string;
    afterParagraph: number;
    caption: string;
    aspect: "portrait" | "landscape" | "square";
    status: "pending" | "approved" | "failed";
  }[];
  /** The gentle tomorrow promise for the NEXT chapter, if any (spoiler-free). */
  tomorrowPromise: string | null;
  isFinalChapter: boolean;
  hasNextPublishedChapter: boolean;
  progress: ReadingProgress | null;
}

export interface SeriesRepository {
  /**
   * Persist the accepted bible + blueprints + plot threads + the initial
   * continuity snapshot in ONE transaction, idempotent by deterministic ids.
   */
  persistSeriesBible(input: PersistSeriesBibleInput): Promise<void>;

  /** True once the accepted bible exists (the chapter stages gate on this). */
  hasAcceptedBible(storyId: string): Promise<boolean>;

  /** The internal series context (spoiler-bearing) for a chapter workflow. */
  getSeriesContext(storyId: string): Promise<SeriesContext | null>;

  /**
   * The series' PINNED visual-profile versions (`characterId → visualProfileId`),
   * captured at creation (rule 8). Consumed by chapter illustration jobs so a
   * child is always rendered from the reference set pinned when the series began,
   * never a later re-approval. Null when the story is not a series with a bible.
   */
  getPinnedVisualProfiles(
    storyId: string,
  ): Promise<Record<string, string> | null>;

  /**
   * The immutable continuity snapshot chain for a series, ordered by chapter (M9
   * regeneration). Used to compute the LATER-chapter dependencies a chapter
   * regeneration must preserve (`assertRegenerationPreservesDependencies`).
   */
  getContinuitySnapshots(
    storyId: string,
  ): Promise<{ afterChapterNumber: number; state: ContinuityState }[]>;

  /**
   * Publish a series chapter ATOMICALLY (`orchestration.md` "Publication
   * transaction"): accepted revision + NEW continuity snapshot + plot-thread
   * states + publication + advance, in one transaction guarded by an advisory
   * lock + the partial-unique-accepted / snapshot-chain constraints. Idempotent.
   */
  publishSeriesChapter(
    input: PublishSeriesChapterInput,
  ): Promise<{ chapterId: string; revisionId: string }>;

  /** Child-facing overview — spoiler-free premise + published chapter list. */
  getSeriesReaderOverview(
    familyId: string,
    storyId: string,
  ): Promise<SeriesReaderOverview | null>;

  /** Child-facing chapter reader — accepted/published content only, or null. */
  getSeriesChapterReader(
    familyId: string,
    userId: string,
    storyId: string,
    chapterNumber: number,
  ): Promise<SeriesChapterReaderView | null>;
}
