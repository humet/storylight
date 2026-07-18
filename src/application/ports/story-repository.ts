import type {
  ReviewArtifact,
  ReviewDecisionKind,
} from "@/domain/review-policy";
import type {
  ReadingAgeBand,
  SafetyConfig,
  SuspenseLevel,
} from "@/domain/story-dna";
import type { OneOffPlan } from "@/domain/story-draft";

/**
 * STORY persistence PORT — owned by the application so policy never depends on
 * Drizzle. The Drizzle impl lives in `src/db/repositories/story-repository.ts`.
 * Every read is FAMILY-SCOPED (a guessed id from another family resolves to
 * nothing) and every READER read model returns ONLY accepted/published content
 * (domain rule 9): a `blocked`, `failed`, or still-`generating` story, or a
 * superseded/rejected revision, is never returned to a reader.
 */

/** Family-level parent safety configuration (`safety-age-appropriateness.md`). */
export interface StoryPreferences extends SafetyConfig {
  allowRealFamilyMembers: boolean;
  allowFictionaliseSchoolHome: boolean;
}

export const DEFAULT_STORY_PREFERENCES: StoryPreferences = {
  readingAge: "5-7",
  maxSuspense: "mild",
  allowMildPeril: true,
  allowDeathGrief: false,
  allowRealFamilyMembers: false,
  allowFictionaliseSchoolHome: true,
  excludedTopics: [],
};

export interface StoryPreferencesPatch {
  readingAge?: ReadingAgeBand;
  maxSuspense?: SuspenseLevel;
  allowMildPeril?: boolean;
  allowDeathGrief?: boolean;
  allowRealFamilyMembers?: boolean;
  allowFictionaliseSchoolHome?: boolean;
  excludedTopics?: string[];
}

export type StoryLifecycleStatus =
  "generating" | "published" | "blocked" | "failed";

/** Internal story record (not a reader read model). */
export interface StoryRecord {
  id: string;
  familyId: string;
  userId: string;
  type: "one_off" | "series";
  status: StoryLifecycleStatus;
  title: string | null;
  createdAt: Date;
  publishedAt: Date | null;
}

/** Compact story summary for the library / home lists (reader-safe). */
export interface StorySummary {
  id: string;
  title: string | null;
  status: StoryLifecycleStatus;
  updatedAt: Date;
  publishedAt: Date | null;
}

export interface ReaderIllustrationSlot {
  anchorKey: string;
  afterParagraph: number;
  caption: string;
  aspect: "portrait" | "landscape" | "square";
}

export interface ReadingProgress {
  scrollProportion: number;
  paragraphAnchor: number;
  completed: boolean;
}

/** The purpose-built reader payload — accepted content ONLY (`api.md` "Reader API"). */
export interface StoryReaderView {
  storyId: string;
  chapterId: string;
  title: string;
  paragraphs: string[];
  illustrations: ReaderIllustrationSlot[];
  progress: ReadingProgress | null;
}

export interface PublishOneOffInput {
  familyId: string;
  storyId: string;
  /** For deterministic (idempotent) ids across a stage re-run. */
  workflowId: string;
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
  }[];
  now?: Date;
}

export interface SaveReadingProgressInput {
  familyId: string;
  userId: string;
  storyId: string;
  chapterId: string;
  scrollProportion: number;
  paragraphAnchor: number;
  completed: boolean;
  now?: Date;
}

export interface StoryRepository {
  /** Create the story row (idempotent by id). */
  createStoryIfAbsent(input: {
    id: string;
    familyId: string;
    userId: string;
    type: "one_off" | "series";
  }): Promise<{ created: boolean }>;

  getStory(familyId: string, storyId: string): Promise<StoryRecord | null>;

  /** The family's preferences, or the defaults when none are stored (no write). */
  getStoryPreferences(familyId: string): Promise<StoryPreferences>;

  /** Get-or-create the preferences row, returning the effective values. */
  ensureStoryPreferences(familyId: string): Promise<StoryPreferences>;

  updateStoryPreferences(
    familyId: string,
    patch: StoryPreferencesPatch,
  ): Promise<StoryPreferences>;

  setStoryStatus(
    familyId: string,
    storyId: string,
    status: StoryLifecycleStatus,
  ): Promise<void>;

  /**
   * Publish the one-off chapter ATOMICALLY: accepted revision + publication +
   * illustration specs + story published, in ONE transaction. Idempotent via
   * deterministic ids. Returns the chapter + revision ids.
   */
  publishOneOffChapter(
    input: PublishOneOffInput,
  ): Promise<{ chapterId: string; revisionId: string }>;

  /** Reader read model — accepted/published ONLY, or null. */
  getStoryReader(
    familyId: string,
    userId: string,
    storyId: string,
  ): Promise<StoryReaderView | null>;

  /** Library list: published + in-progress stories (never blocked/failed). */
  listLibrary(familyId: string): Promise<StorySummary[]>;

  saveReadingProgress(input: SaveReadingProgressInput): Promise<void>;

  getReadingProgress(
    familyId: string,
    userId: string,
    storyId: string,
  ): Promise<ReadingProgress | null>;
}
