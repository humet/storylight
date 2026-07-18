import { z } from "zod";

import { boundedString, semanticKey, type WireSchema } from "./wire";

/**
 * CHAPTER PLAN wire schema (`docs/03-ai/orchestration.md` "Create chapter plan";
 * `docs/02-storytelling/story-series.md` chapter shape). The chapter-planning stage
 * turns the pinned series bible's blueprint + the latest continuity snapshot into a
 * concrete plan for ONE nightly chapter, BEFORE any prose. Same normalised shape as
 * the one-off plan (so the chapter draft/validation machinery is reused), but a
 * distinct published `schemaVersion`. Strict object, bounded strings/arrays,
 * semantic keys, `schemaVersion` on the root.
 */

const SCHEMA_VERSION = "chapter-plan.v1";

const BeatWireSchema = z.strictObject({
  key: semanticKey(),
  description: boundedString(1, 400),
});

export const ChapterPlanArtifactV1 = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  title: boundedString(1, 120),
  setting: boundedString(1, 400),
  /** References one of the canonical cast character keys. */
  protagonistKey: semanticKey(),
  protagonistDesire: boundedString(1, 400),
  obstacle: boundedString(1, 400),
  emotionalTheme: boundedString(1, 200),
  beats: z.array(BeatWireSchema).min(6).max(10),
  climax: boundedString(1, 600),
  resolution: boundedString(1, 600),
  /** The gentle close that carries the chapter's tomorrow promise. */
  calmingClose: boundedString(1, 600),
});

export type ChapterPlanWire = z.infer<typeof ChapterPlanArtifactV1>;

export const chapterPlanWireSchema: WireSchema<ChapterPlanWire> = {
  schemaVersion: SCHEMA_VERSION,
  name: "StorylightChapterPlan",
  description:
    "A complete plan for a single nightly series chapter: title, setting, the protagonist's local desire and obstacle, an emotional theme, 6 to 10 ordered beats, a climax, a resolution, and a calming close that anticipates tomorrow.",
  schema: ChapterPlanArtifactV1,
};
