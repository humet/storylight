import { z } from "zod";

import { boundedString, semanticKey, type WireSchema } from "./wire";

/**
 * CHAPTER DRAFT wire schema (`docs/02-storytelling/story-engine.md` draft stage;
 * `docs/03-ai/structured-output.md`). The writing stage turns the plan into prose
 * paragraphs. It also ASSERTS which plan beats it covered and marks illustration
 * anchors — both verified by DETERMINISTIC app checks (`story-draft.ts`), never
 * trusted from the model. Strict object, bounded strings/arrays, `schemaVersion`.
 *
 * Reused by the revision stage (same shape, different prompt/capability).
 */

const SCHEMA_VERSION = "chapter-draft.v1";

const AnchorWireSchema = z.strictObject({
  key: semanticKey(),
  /** Insert the illustration AFTER this paragraph index (0 = before all prose). */
  afterParagraph: z.number().int().min(0).max(80),
  description: boundedString(1, 400),
});

export const ChapterDraftArtifactV1 = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  title: boundedString(1, 120),
  paragraphs: z.array(boundedString(1, 1400)).min(3).max(80),
  /** Plan beat keys the writer covered (checked against the plan). */
  beatsCovered: z.array(semanticKey()).min(6).max(10),
  illustrationAnchors: z.array(AnchorWireSchema).max(5),
});

export type ChapterDraftWire = z.infer<typeof ChapterDraftArtifactV1>;

export const chapterDraftWireSchema: WireSchema<ChapterDraftWire> = {
  schemaVersion: SCHEMA_VERSION,
  name: "StorylightChapterDraft",
  description:
    "A complete bedtime-story draft as ordered prose paragraphs, the plan beats it covers, and up to five illustration anchors marking where a picture belongs.",
  schema: ChapterDraftArtifactV1,
};
