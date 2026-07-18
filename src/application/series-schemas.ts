import { z } from "zod";

import { STORY_LENGTHS, STORY_TONES } from "@/domain/story-dna";

/**
 * Zod v4 command schemas for the SERIES surfaces (AGENTS.md: "Zod v4 at runtime
 * boundaries"). Parsed in the Server Action before any application service runs.
 * The idea/theme are UNTRUSTED free text: bounded here, treated as narrative data
 * (never instructions) downstream. `chapterCount` is the MVP 5/10 choice.
 */

export const CreateSeriesCommandSchema = z.object({
  requestId: z.string().trim().min(1).max(200),
  idea: z.string().trim().min(1).max(500),
  characterIds: z.array(z.uuid()).min(1).max(6),
  length: z.enum(STORY_LENGTHS),
  tone: z.enum(STORY_TONES),
  theme: z.string().trim().max(120).nullable().default(null),
  chapterCount: z.union([z.literal(5), z.literal(10)]),
});
export type CreateSeriesCommand = z.infer<typeof CreateSeriesCommandSchema>;

export const ContinueSeriesCommandSchema = z.object({
  storyId: z.uuid(),
});
export type ContinueSeriesCommand = z.infer<typeof ContinueSeriesCommandSchema>;

export const SaveSeriesProgressCommandSchema = z.object({
  storyId: z.uuid(),
  chapterNumber: z.number().int().min(1).max(20),
  scrollProportion: z.number().min(0).max(1),
  paragraphAnchor: z.number().int().min(0).max(5000),
  completed: z.boolean(),
});
export type SaveSeriesProgressCommand = z.infer<
  typeof SaveSeriesProgressCommandSchema
>;
