import { z } from "zod";

import {
  READING_AGE_BANDS,
  STORY_LENGTHS,
  STORY_TONES,
  SUSPENSE_LEVELS,
} from "@/domain/story-dna";

/**
 * Zod v4 command schemas — the runtime boundary for the story surfaces
 * (AGENTS.md: "Zod v4 at runtime boundaries"; `docs/05-backend/api.md`). Parsed
 * in the Server Action before any application service runs. The idea is UNTRUSTED
 * free text: bounded here, treated as narrative data (never instructions) by the
 * prompt envelope downstream.
 */

export const CreateOneOffStoryCommandSchema = z.object({
  /** Stable idempotency key (`orchestration.md`). */
  requestId: z.string().trim().min(1).max(200),
  idea: z.string().trim().min(1).max(500),
  characterIds: z.array(z.uuid()).min(1).max(6),
  length: z.enum(STORY_LENGTHS),
  tone: z.enum(STORY_TONES),
  theme: z.string().trim().max(120).nullable().default(null),
});
export type CreateOneOffStoryCommand = z.infer<
  typeof CreateOneOffStoryCommandSchema
>;

export const UpdateStoryPreferencesCommandSchema = z.object({
  readingAge: z.enum(READING_AGE_BANDS).optional(),
  maxSuspense: z.enum(SUSPENSE_LEVELS).optional(),
  allowMildPeril: z.boolean().optional(),
  allowDeathGrief: z.boolean().optional(),
  allowRealFamilyMembers: z.boolean().optional(),
  allowFictionaliseSchoolHome: z.boolean().optional(),
  excludedTopics: z.array(z.string().trim().min(1).max(80)).max(40).optional(),
});
export type UpdateStoryPreferencesCommand = z.infer<
  typeof UpdateStoryPreferencesCommandSchema
>;

export const SaveReadingProgressCommandSchema = z.object({
  storyId: z.uuid(),
  scrollProportion: z.number().min(0).max(1),
  paragraphAnchor: z.number().int().min(0).max(5000),
  completed: z.boolean(),
});
export type SaveReadingProgressCommand = z.infer<
  typeof SaveReadingProgressCommandSchema
>;
