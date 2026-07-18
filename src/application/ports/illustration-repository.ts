import type { IllustrationState, VisionVerdict } from "@/domain/image-job";
import type {
  ImageSceneRequest,
  IllustrationAspect,
} from "@/domain/image-request";

/**
 * ILLUSTRATION persistence PORT — owned by the application (rule 12). The Drizzle
 * impl lives in `src/db/repositories/illustration-repository.ts`. Every read/write
 * is FAMILY-SCOPED. Published illustrations are IMMUTABLE revisions (rule 5);
 * rejected/quarantined originals are unreachable by delivery (rule 9), enforced by
 * the `approved` state + the approved publication join in {@link getDeliverable}.
 */

/** The full context an image job needs, resolved from a spec id. */
export interface SpecJob {
  specId: string;
  familyId: string;
  storyId: string;
  storyType: "one_off" | "series";
  chapterId: string;
  chapterRevisionId: string;
  anchorKey: string;
  caption: string;
  sceneDescription: string;
  aspect: IllustrationAspect;
  /** DB character ids of the children in this scene. */
  subjectCharacterIds: string[];
  prominentCharacterId: string | null;
  /** Highest existing illustration revision number for this spec (0 when none). */
  latestRevisionNumber: number;
}

/** A quarantined original to record (bytes already uploaded to storage). */
export interface RecordOriginalInput {
  id: string;
  familyId: string;
  storyId: string;
  chapterId: string;
  chapterRevisionId: string;
  specId: string;
  phase: string;
  storageKey: string;
  contentType: string;
  checksum: string;
  byteSize: number;
  width: number;
  height: number;
  model: string;
  seed: number;
}

export interface RecordReviewInput {
  id: string;
  familyId: string;
  specId: string;
  workflowId: string;
  phase: string;
  verdict: VisionVerdict;
  decision: string;
}

/** An approved derivative to persist alongside its original. */
export interface DerivativeRecord {
  id: string;
  storageKey: string;
  contentType: string;
  checksum: string;
  byteSize: number;
  width: number;
  height: number;
  variantWidth: number;
}

export interface PublishApprovedInput {
  familyId: string;
  storyId: string;
  chapterId: string;
  chapterRevisionId: string;
  specId: string;
  /** The approved original asset id (already recorded quarantined). */
  originalAssetId: string;
  revisionId: string;
  revisionNumber: number;
  publicationId: string;
  model: string;
  artBibleVersion: string;
  imageRouteVersion: string;
  requestSnapshot: ImageSceneRequest;
  verdictSnapshot: VisionVerdict;
  derivatives: DerivativeRecord[];
  now?: Date;
}

export interface DeliverableIllustration {
  storageKey: string;
  contentType: string;
}

export interface IllustrationRepository {
  /** Resolve the job context for a spec (family-scoped), or null. */
  getSpecJob(familyId: string, specId: string): Promise<SpecJob | null>;

  /** Spec ids for a chapter revision, in order (used to dispatch one job each). */
  listSpecIdsForChapterRevision(
    familyId: string,
    chapterRevisionId: string,
  ): Promise<string[]>;

  /** Create the publication row in `pending` if absent (idempotent). */
  ensurePublicationPending(input: {
    familyId: string;
    storyId: string;
    specId: string;
  }): Promise<void>;

  /** Record a quarantined original (idempotent by deterministic id). */
  recordOriginal(input: RecordOriginalInput): Promise<void>;

  /** Record a vision review + its decision (idempotent). */
  recordReview(input: RecordReviewInput): Promise<void>;

  /**
   * Publish an approved illustration ATOMICALLY: approve the original, insert its
   * responsive derivatives, mint the next immutable illustration revision, RETIRE
   * the prior approved revision's assets, and upsert the publication to `approved`.
   * Idempotent via deterministic ids.
   */
  publishApproved(input: PublishApprovedInput): Promise<void>;

  /** Set the publication to a terminal non-approved state (manual-review / failed / pending). */
  setPublicationState(input: {
    familyId: string;
    storyId: string;
    specId: string;
    state: IllustrationState;
  }): Promise<void>;

  /** The current publication state for a spec, or null when no publication exists. */
  getPublicationState(
    familyId: string,
    specId: string,
  ): Promise<IllustrationState | null>;

  /**
   * The deliverable APPROVED asset for a spec (best derivative ≤ requested width,
   * else the original), ONLY when the publication is `approved` and the asset is
   * `approved`. Returns null otherwise — rejected/quarantined/retired assets and
   * non-approved publications are unreachable (rule 9).
   */
  getDeliverable(
    familyId: string,
    specId: string,
    maxWidth?: number,
  ): Promise<DeliverableIllustration | null>;
}
