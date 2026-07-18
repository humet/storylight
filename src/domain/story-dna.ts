import { slugifyName } from "./character-key";

/**
 * A local SEMANTIC KEY — models emit these, never database ids
 * (`structured-output.md` "IDs"). Mirrors the wire-schema regex; kept here so the
 * domain never depends on the application layer.
 */
const SEMANTIC_KEY_REGEX = /^[a-z][a-z0-9-]{1,63}$/;

/**
 * STORY DNA (`docs/02-storytelling/story-engine.md` one-off flow: Idea → Story DNA
 * → Plan; `docs/02-storytelling/one-off-stories.md`). Story DNA is the compact,
 * DETERMINISTIC planning specification the application derives — in pure app code,
 * never a model — from the parent's request plus the family's saved safety
 * configuration and the selected characters. It becomes the CANONICAL context the
 * planning stage elaborates into a full plan.
 *
 * ADR-006's appendix delegated the concrete schema to M7. It bundles:
 *  - the derived reading constraints (reading-age band → words-per-minute → a
 *    word-count target band; the length choice → target minutes + a beat band);
 *  - the enum-constrained creative direction (tone, suspense);
 *  - the resolved cast (app ids + story-scoped semantic keys + names);
 *  - the safety guard rails (prohibited outcomes) assembled from the bedtime-
 *    suitability "should avoid" list plus the family's stricter choices.
 *
 * Everything here is trusted STRUCTURE. The only free-text values are character
 * names and parent excluded topics, which the prompt envelope escapes when they
 * enter `<canonical_context>` (`global-policy.ts` CANONICAL-CONTEXT RULE). The
 * untrusted story idea is NEVER part of Story DNA — it flows separately as
 * `<untrusted_input>`.
 *
 * Pure module: types + a pure derivation. No IO, no provider SDK.
 */

export const READING_AGE_BANDS = ["3-4", "5-7", "8-10"] as const;
export type ReadingAgeBand = (typeof READING_AGE_BANDS)[number];

export const STORY_LENGTHS = ["short", "standard", "long"] as const;
export type StoryLength = (typeof STORY_LENGTHS)[number];

export const STORY_TONES = [
  "gentle",
  "playful",
  "adventurous",
  "cosy",
] as const;
export type StoryTone = (typeof STORY_TONES)[number];

/** Maximum suspense a bedtime story may reach (`safety-age-appropriateness.md`). */
export const SUSPENSE_LEVELS = ["calm", "mild", "adventurous"] as const;
export type SuspenseLevel = (typeof SUSPENSE_LEVELS)[number];

/**
 * WORD-COUNT DERIVATION (documented in BUILD_STATE M7). Read-aloud bedtime pace
 * scales with the reading age; the word-count target is `minutes × words-per-
 * minute`, with a ±20% band so a natural draft is neither padded nor clipped.
 */
const WORDS_PER_MINUTE: Record<ReadingAgeBand, number> = {
  "3-4": 90,
  "5-7": 115,
  "8-10": 135,
};

/** Target reading minutes per length (`one-off-stories.md` suggested defaults, midpoints). */
const TARGET_MINUTES: Record<StoryLength, number> = {
  short: 6, // 5–7 minutes
  standard: 10, // 8–12 minutes
  long: 13, // 12–15 minutes
};

/**
 * Beat band per length, always within the one-off 6–10 range
 * (`one-off-stories.md` "6–10 story beats"). A short story leans to the low end
 * so it never reads like a compressed ten-chapter series.
 */
const BEAT_BAND: Record<StoryLength, { min: number; max: number }> = {
  short: { min: 6, max: 7 },
  standard: { min: 7, max: 9 },
  long: { min: 8, max: 10 },
};

/** ±20% band around the derived word-count midpoint. */
const WORD_COUNT_TOLERANCE = 0.2;

export interface StoryDnaCharacter {
  /** Application character id (never model-generated). */
  id: string;
  /** Story-scoped semantic key the model references; never a database id. */
  key: string;
  name: string;
  apparentAge: number;
}

/** The family's effective safety configuration feeding Story DNA. */
export interface SafetyConfig {
  readingAge: ReadingAgeBand;
  maxSuspense: SuspenseLevel;
  allowMildPeril: boolean;
  allowDeathGrief: boolean;
  excludedTopics: string[];
}

export interface StoryDna {
  readingAge: ReadingAgeBand;
  length: StoryLength;
  targetReadingMinutes: number;
  wordCountTarget: { min: number; max: number };
  beatTarget: { min: number; max: number };
  tone: StoryTone;
  suspense: SuspenseLevel;
  characters: StoryDnaCharacter[];
  /** Guard rails the plan and draft must never cross (safety, app-authored + parent). */
  prohibitedOutcomes: string[];
  allowMildPeril: boolean;
  allowDeathGrief: boolean;
}

/** The bedtime "should avoid" list, always prohibited (`safety-age-appropriateness.md`). */
const BASE_PROHIBITED_OUTCOMES: readonly string[] = [
  "graphic harm or injury",
  "prolonged helplessness",
  "unresolved abandonment",
  "humiliating moral punishment",
  "a maximum-danger cliffhanger",
  "frightening visual detail",
  "adult themes",
  "an unresolved sequel hook that leaves the central problem open",
];

const SUSPENSE_RANK: Record<SuspenseLevel, number> = {
  calm: 0,
  mild: 1,
  adventurous: 2,
};

/** The lower (stricter) of two suspense levels. */
function capSuspense(
  requested: SuspenseLevel,
  ceiling: SuspenseLevel,
): SuspenseLevel {
  return SUSPENSE_RANK[requested] <= SUSPENSE_RANK[ceiling]
    ? requested
    : ceiling;
}

/**
 * Build unique, readable, semantic-key-valid story-scoped keys for the cast. A
 * key is a slug of the name; collisions are disambiguated with a numeric suffix,
 * and a slug that would not start with a letter is prefixed so it satisfies
 * {@link SEMANTIC_KEY_REGEX}.
 */
export function buildStoryCharacterKeys(
  characters: { id: string; name: string; apparentAge: number }[],
): StoryDnaCharacter[] {
  const used = new Set<string>();
  return characters.map((c) => {
    let base = slugifyName(c.name);
    if (!/^[a-z]/.test(base)) base = `c-${base}`;
    // Bound to the semantic-key length and keep room for a disambiguating suffix.
    base = base.slice(0, 48).replace(/-+$/g, "") || "character";
    let key = base;
    let n = 2;
    while (used.has(key)) key = `${base}-${n++}`;
    used.add(key);
    return { id: c.id, key, name: c.name, apparentAge: c.apparentAge };
  });
}

export interface DeriveStoryDnaInput {
  length: StoryLength;
  tone: StoryTone;
  /** Optional per-request suspense; capped by the family ceiling. */
  requestedSuspense?: SuspenseLevel;
  characters: { id: string; name: string; apparentAge: number }[];
  safety: SafetyConfig;
}

/**
 * Derive the canonical Story DNA (pure). The reading-age, minutes, word-count
 * band, beat band, and prohibited outcomes are all APPLICATION calculations
 * (`structured-output.md` "Canonical calculations"); the model never sets them.
 */
export function deriveStoryDna(input: DeriveStoryDnaInput): StoryDna {
  const { readingAge } = input.safety;
  const minutes = TARGET_MINUTES[input.length];
  const midWords = WORDS_PER_MINUTE[readingAge] * minutes;
  const wordCountTarget = {
    min: Math.round(midWords * (1 - WORD_COUNT_TOLERANCE)),
    max: Math.round(midWords * (1 + WORD_COUNT_TOLERANCE)),
  };

  const suspense = capSuspense(
    input.requestedSuspense ?? input.safety.maxSuspense,
    input.safety.maxSuspense,
  );

  const prohibited = [...BASE_PROHIBITED_OUTCOMES];
  if (!input.safety.allowMildPeril) {
    prohibited.push("any real physical peril or danger to a character");
  }
  if (!input.safety.allowDeathGrief) {
    prohibited.push("death, dying, or grief");
  }
  for (const topic of input.safety.excludedTopics) {
    const trimmed = topic.trim();
    if (trimmed) prohibited.push(`the excluded topic "${trimmed}"`);
  }

  return {
    readingAge,
    length: input.length,
    targetReadingMinutes: minutes,
    wordCountTarget,
    beatTarget: BEAT_BAND[input.length],
    tone: input.tone,
    suspense,
    characters: buildStoryCharacterKeys(input.characters),
    prohibitedOutcomes: prohibited,
    allowMildPeril: input.safety.allowMildPeril,
    allowDeathGrief: input.safety.allowDeathGrief,
  };
}

/** Guard the value satisfies the semantic-key shape (used in tests + validators). */
export function isSemanticKey(value: string): boolean {
  return SEMANTIC_KEY_REGEX.test(value);
}
