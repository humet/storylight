import { z } from "zod";

import type {
  CharacterProfilePayload,
  FictionalisationPolicy,
  NarrativeIdentity,
  SpeechStyle,
} from "@/domain/character";

/**
 * Zod v4 command schemas — the runtime boundary for the character editor
 * (AGENTS.md: "Zod v4 at runtime boundaries"). Everything crossing from a
 * Server Action into the application layer is parsed here before any repository
 * runs. Free-text lists are trimmed and empties dropped so the stored payload is
 * clean; the arrays default to empty so the shortest mobile creation path still
 * validates.
 */

const trimmedLine = z.string().trim().min(1).max(400);
const lineList = z.array(trimmedLine).max(40).default([]);

export const CharacterTraitSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(600),
  behaviouralSignals: lineList,
  overuseRisks: lineList,
});

export const SpeechStyleSchema = z.object({
  sentenceLength: z.enum(["short", "mixed", "long"]),
  directness: z.enum(["direct", "reflective", "playful"]),
  humourStyle: lineList,
  vocabularyNotes: lineList,
  prohibitedPatterns: lineList,
}) satisfies z.ZodType<SpeechStyle>;

export const NarrativeIdentitySchema = z.object({
  personalityTraits: z.array(CharacterTraitSchema).max(12).default([]),
  strengths: lineList,
  vulnerabilities: lineList,
  interests: lineList,
  values: lineList,
  speechStyle: SpeechStyleSchema,
  behaviourRules: lineList,
  forbiddenCharacterisations: lineList,
}) satisfies z.ZodType<NarrativeIdentity>;

export const FictionalisationPolicySchema = z.object({
  mayUseMagic: z.boolean(),
  mayTransformTemporarily: z.boolean(),
  mayPortrayMildDisagreement: z.boolean(),
  mayPortrayFear: z.boolean(),
  mayUseRealFamilyMembers: z.boolean(),
  mayInventSchoolOrHomeDetails: z.boolean(),
  excludedThemes: lineList,
}) satisfies z.ZodType<FictionalisationPolicy>;

export const CharacterProfilePayloadSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  apparentAge: z.number().int().min(0).max(120),
  pronouns: z.array(z.string().trim().min(1).max(40)).min(1).max(6),
  narrativeIdentity: NarrativeIdentitySchema,
  fictionalisationPolicy: FictionalisationPolicySchema,
  // Visual profile arrives in M4; always null at creation/edit time in M3.
  visualProfileId: z.string().nullable().default(null),
}) satisfies z.ZodType<CharacterProfilePayload>;

/** Create: the full editable payload (family + key are derived server-side). */
export const CreateCharacterProfileCommandSchema =
  CharacterProfilePayloadSchema;

/** Update: which character, plus the new full payload (a permanent change). */
export const UpdateCharacterProfileCommandSchema = z.object({
  characterId: z.uuid(),
  payload: CharacterProfilePayloadSchema,
});

/** Approve / retire: identify the character; the transition is fixed by role. */
export const CharacterIdCommandSchema = z.object({
  characterId: z.uuid(),
});

export type CreateCharacterProfileCommand = z.infer<
  typeof CreateCharacterProfileCommandSchema
>;
export type UpdateCharacterProfileCommand = z.infer<
  typeof UpdateCharacterProfileCommandSchema
>;
export type CharacterIdCommand = z.infer<typeof CharacterIdCommandSchema>;
