# Character System

## Purpose

The Character System defines persistent storybook characters: who they are, how they behave, how they speak, what may change, and what must remain stable.

Character identity has two linked but separate parts:

1. Narrative identity
2. Visual identity

Visual identity is specified in the image-generation document. This document focuses on narrative identity.

## Character layers

### Core identity

Stable facts that should rarely change:

- display name
- apparent age band
- pronouns
- family relationships
- core personality traits
- recurring strengths
- recurring vulnerabilities
- general interests
- speech tendencies
- values
- boundaries on fictionalisation

### Story role

Specific to one story or series:

- protagonist
- companion
- guide
- comic foil
- mystery-holder

### Current state

Changes within a chapter or series:

- current goal
- emotion
- location
- possessions
- knowledge
- temporary fear
- active disagreement
- outfit
- temporary transformation

### Long-term memory

Parent-approved facts that may carry between unrelated stories:

- favourite recurring companions
- meaningful discoveries
- established shared jokes
- preferred story roles
- recurring magical items

Long-term memory should be conservative. Not every generated detail becomes part of the permanent character.

## Domain model

```ts
interface CharacterProfile {
  id: string;
  familyId: string;
  key: string;
  displayName: string;
  apparentAge: number;
  pronouns: string[];
  status: "draft" | "active" | "retired";

  narrativeIdentity: NarrativeIdentity;
  fictionalisationPolicy: FictionalisationPolicy;
  visualProfileId: string;

  version: number;
  createdAt: Date;
  approvedAt?: Date;
}
```

```ts
interface NarrativeIdentity {
  personalityTraits: CharacterTrait[];
  strengths: string[];
  vulnerabilities: string[];
  interests: string[];
  values: string[];
  speechStyle: SpeechStyle;
  behaviourRules: string[];
  forbiddenCharacterisations: string[];
}
```

## Trait design

Avoid flat labels such as “brave” or “funny” on their own.

Use traits with behavioural evidence:

```ts
interface CharacterTrait {
  name: string;
  description: string;
  behaviouralSignals: string[];
  overuseRisks: string[];
}
```

Example:

```text
Trait: Meticulous
Signals:
- notices small inconsistencies
- prefers to inspect before acting
- takes pride in completing things carefully

Overuse risks:
- do not make every scene about tidiness
- do not portray caution as cowardice
```

## Contradictions make characters believable

A character may be:

- brave when protecting someone, but nervous when uncertain
- imaginative, but frustrated by rules
- sociable, but sensitive to exclusion
- careful, but impulsive when excited

The model should use these tensions naturally rather than reducing each child to one trait.

## Speech style

Store guidance, not catchphrases.

```ts
interface SpeechStyle {
  sentenceLength: "short" | "mixed" | "long";
  directness: "direct" | "reflective" | "playful";
  humourStyle: string[];
  vocabularyNotes: string[];
  prohibitedPatterns: string[];
}
```

Do not force repeated catchphrases. Repetition quickly becomes artificial.

## Fictionalisation policy

Parents define what the story may change.

```ts
interface FictionalisationPolicy {
  mayUseMagic: boolean;
  mayTransformTemporarily: boolean;
  mayPortrayMildDisagreement: boolean;
  mayPortrayFear: boolean;
  mayUseRealFamilyMembers: boolean;
  mayInventSchoolOrHomeDetails: boolean;
  excludedThemes: string[];
}
```

The application should not invent sensitive real-world details about a child.

## Character growth

Series may develop a character’s current beliefs and confidence, but must not erase core identity.

Growth should look like:

- learning to ask for help
- recognising another person’s feelings
- becoming more confident in one context
- repairing a disagreement

Growth should not look like:

- replacing the character’s personality
- permanently “fixing” a normal vulnerability
- turning a careful child into a reckless one
- using a moral lesson to shame the character

## Relationships

Relationships are first-class.

```ts
interface CharacterRelationship {
  fromCharacterId: string;
  toCharacterId: string;
  type: string;
  baseline: string;
  currentState?: string;
  boundaries: string[];
}
```

A sibling relationship can contain warmth, rivalry, humour, and repair. It should not become a generic “best friends who always agree” dynamic.

## Parent approval

Require parent approval for permanent changes to:

- core traits
- speech guidance
- fictionalisation boundaries
- long-term memories
- apparent age
- family relationships

Ordinary chapter state changes do not require approval.

## Context selection

Writers receive only characters relevant to the chapter plus relationship summaries. They do not receive all family profile data.

## Acceptance criteria

- Characters remain recognisable in behaviour across stories.
- The model does not reduce a character to one trait.
- Speech styles are distinct without forced catchphrases.
- Temporary story state does not overwrite core identity.
- Long-term memory additions require conservative policy or parent approval.
- Sensitive real-world details are never invented as fact.
