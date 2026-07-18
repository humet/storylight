import { z } from "zod";

import type { WorkflowDefinition } from "../workflow-engine";
import { createChapterStages, type ChapterStagesDeps } from "./chapter-stages";

/**
 * `generate-next-chapter` — generate the NEXT chapter of an existing series
 * (`docs/03-ai/orchestration.md` "Chapter generation sequence"). It runs the SHARED
 * chapter stages, which determine the next chapter from the accepted-chapter count,
 * build context from the PINNED bible + latest continuity snapshot, and publish the
 * chapter + new snapshot atomically.
 *
 * ONLY ONE workflow may generate a given chapter number (`story-series.md`). The
 * COLLAPSE is guaranteed at two layers: the "Continue tonight" command derives a
 * DETERMINISTIC `requestId` per (series, target chapter), so concurrent taps dedupe
 * on `UNIQUE(user_id, request_id, workflow_type)` (the advisory app lock); and even
 * two distinct workflows racing to publish the same chapter collapse onto one
 * accepted revision via deterministic ids + the partial-unique-accepted / snapshot
 * constraints.
 */

export const GENERATE_NEXT_CHAPTER_TYPE = "generate-next-chapter";

export const GenerateNextChapterInputSchema = z.object({
  storyId: z.uuid(),
});
export type GenerateNextChapterInput = z.infer<
  typeof GenerateNextChapterInputSchema
>;

export function createGenerateNextChapterWorkflow(
  deps: ChapterStagesDeps,
): WorkflowDefinition<GenerateNextChapterInput> {
  return {
    type: GENERATE_NEXT_CHAPTER_TYPE,
    capability: "story:create",
    inputSchema: GenerateNextChapterInputSchema,
    pendingLabel: "Writing tonight's chapter",
    entityId: (input) => input.storyId,
    stages: createChapterStages(deps),
  };
}
