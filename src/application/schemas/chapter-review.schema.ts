import { z } from "zod";

import { REVIEW_FINDING_CODES } from "@/domain/review-policy";
import { boundedString, type WireSchema } from "./wire";

/**
 * CHAPTER REVIEW wire schema (`docs/02-storytelling/safety-age-appropriateness.md`
 * "Review severity"; `docs/02-storytelling/one-off-stories.md` "Review"). The
 * review model produces an ADVISORY artifact — the checklist booleans plus graded
 * findings. The application's pure `decideReviewOutcome` policy, NOT this artifact,
 * makes the publish/revise/block decision (`structured-output.md`: "Review models
 * cannot override deterministic policy").
 *
 * Strict object, closed finding-code enum, bounded strings/arrays, `schemaVersion`.
 */

const SCHEMA_VERSION = "chapter-review.v1";

const FindingWireSchema = z.strictObject({
  code: z.enum(REVIEW_FINDING_CODES),
  severity: z.enum(["blocking", "major", "minor"]),
  note: boundedString(1, 300),
});

export const ChapterReviewArtifactV1 = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  completeArc: z.boolean(),
  resolvesCentralProblem: z.boolean(),
  endsCalmly: z.boolean(),
  /** True is BAD: the story leans on a sequel to feel complete. */
  sequelDependency: z.boolean(),
  ageAppropriate: z.boolean(),
  findings: z.array(FindingWireSchema).max(20),
  summary: boundedString(1, 400),
});

export type ChapterReviewWire = z.infer<typeof ChapterReviewArtifactV1>;

export const chapterReviewWireSchema: WireSchema<ChapterReviewWire> = {
  schemaVersion: SCHEMA_VERSION,
  name: "StorylightChapterReview",
  description:
    "An advisory review of a bedtime-story draft: whether the arc completes, the central problem resolves, it ends calmly, it avoids sequel dependency, it is age appropriate, plus a list of graded findings.",
  schema: ChapterReviewArtifactV1,
};
