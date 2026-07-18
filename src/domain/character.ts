/**
 * Character narrative-identity domain types (`docs/02-storytelling/character-system.md`).
 *
 * These are the exact interfaces from the character-system spec. They are pure
 * domain shapes, deliberately INDEPENDENT of Drizzle row types (AGENTS.md: "Keep
 * domain types independent of DB row types"). The database maps rows to these;
 * nothing in the domain or application layer imports a table's inferred type.
 *
 * This module covers NARRATIVE identity only. Visual identity (references, art
 * bibles) is specified separately and arrives in M4 — hence `visualProfileId` is
 * a nullable forward pointer here (see BUILD_STATE deviation note).
 */

/** A character's lifecycle status. Transitions live in `character-status.ts`. */
export type CharacterStatus = "draft" | "active" | "retired";

/**
 * A personality trait carrying behavioural evidence rather than a flat label
 * (`character-system.md` "Trait design"). Storing signals and overuse risks is
 * what lets a writer portray the trait without reducing the child to one word.
 */
export interface CharacterTrait {
  name: string;
  description: string;
  behaviouralSignals: string[];
  overuseRisks: string[];
}

/**
 * How a character speaks. Guidance, never catchphrases — repetition quickly
 * reads as artificial (`character-system.md` "Speech style").
 */
export interface SpeechStyle {
  sentenceLength: "short" | "mixed" | "long";
  directness: "direct" | "reflective" | "playful";
  humourStyle: string[];
  vocabularyNotes: string[];
  prohibitedPatterns: string[];
}

/** The stable, permanent-change-gated core of who a character is. */
export interface NarrativeIdentity {
  personalityTraits: CharacterTrait[];
  strengths: string[];
  vulnerabilities: string[];
  interests: string[];
  values: string[];
  speechStyle: SpeechStyle;
  behaviourRules: string[];
  forbiddenCharacterisations: string[];
}

/**
 * What the story may change about a real child. Parents own these boundaries;
 * the application must never invent sensitive real-world details
 * (`character-system.md` "Fictionalisation policy").
 */
export interface FictionalisationPolicy {
  mayUseMagic: boolean;
  mayTransformTemporarily: boolean;
  mayPortrayMildDisagreement: boolean;
  mayPortrayFear: boolean;
  mayUseRealFamilyMembers: boolean;
  mayInventSchoolOrHomeDetails: boolean;
  excludedThemes: string[];
}

/**
 * A persistent storybook character. `key` is an app-generated semantic key
 * (never a model- or user-supplied id); `id` is the database primary key.
 * `version` is the number of the CURRENT profile version — a permanent change
 * mints a new version (see `character-system.md` "Parent approval" and the
 * repository).
 */
export interface CharacterProfile {
  id: string;
  familyId: string;
  key: string;
  displayName: string;
  apparentAge: number;
  pronouns: string[];
  status: CharacterStatus;

  narrativeIdentity: NarrativeIdentity;
  fictionalisationPolicy: FictionalisationPolicy;
  /**
   * Forward pointer to the visual profile (M4). Null until a visual profile is
   * approved — the spec types this `string`, but visual identity is a later
   * milestone, so M3 stores it nullable (recorded in BUILD_STATE deviations).
   */
  visualProfileId: string | null;

  version: number;
  createdAt: Date;
  approvedAt?: Date;
}

/**
 * A first-class relationship between two characters (`character-system.md`
 * "Relationships"). A sibling bond can hold warmth, rivalry, humour and repair
 * at once — it should not flatten to "best friends who always agree".
 */
export interface CharacterRelationship {
  fromCharacterId: string;
  toCharacterId: string;
  type: string;
  baseline: string;
  currentState?: string;
  boundaries: string[];
}

/**
 * The mutable, versioned payload of a character profile — everything a permanent
 * change can alter. Creating a character captures version 1 of this; editing it
 * mints the next version. Lifecycle (`status`, `approvedAt`) is NOT part of the
 * payload — approval and retirement change status without minting a version.
 */
export interface CharacterProfilePayload {
  displayName: string;
  apparentAge: number;
  pronouns: string[];
  narrativeIdentity: NarrativeIdentity;
  fictionalisationPolicy: FictionalisationPolicy;
  visualProfileId: string | null;
}

/** Compact projection for list surfaces (the parent character grid). */
export interface CharacterSummary {
  id: string;
  key: string;
  displayName: string;
  status: CharacterStatus;
  apparentAge: number;
  version: number;
  traitCount: number;
  approvedAt?: Date;
}
