# Continuity Architecture

## Purpose

Continuity is the structured state that allows a series to remain coherent across nights. It must not depend on model memory or a growing conversation transcript.

## Continuity layers

### Immutable series facts

Examples:

- the library has twelve doors
- a character’s core identity
- the planned ending
- a magical rule

### Current state

Examples:

- current location
- current time
- current emotion
- active outfit
- carried objects
- temporary conditions

### Knowledge

Track what each character knows separately from what the reader knows.

### Relationships

Track meaningful changes such as trust, disagreement, apology, or alliance.

### Plot threads

Track lifecycle:

- planned
- introduced
- developing
- resolved

### Visual continuity

Track outfits, props, location versions, temporary appearance changes, and creature references.

## Canonical model

```ts
interface ContinuityState {
  schemaVersion: "1.0";
  seriesId: string;
  afterChapterNumber: number;
  currentTime: string;
  currentLocationId: string;

  characters: Record<string, CharacterContinuityState>;
  world: WorldContinuityState;
  plotThreads: Record<string, PlotThreadContinuityState>;
  establishedFacts: ContinuityFact[];
  visual: VisualContinuityState;
}
```

## Change-set pattern

The model proposes a `ContinuityChangeSet`. It never returns the canonical next state.

Application code:

1. Validates references.
2. Rejects contradictions.
3. Applies the change set through a pure function.
4. Persists an immutable snapshot.

```ts
function applyContinuityChanges(
  previous: ContinuityState,
  changes: ContinuityChangeSet,
  chapterNumber: number,
): ContinuityState;
```

## Validation rules

Reject changes that:

- reference unknown characters or locations
- remove an object not held
- resolve an unintroduced thread
- regress a resolved thread
- change immutable identity
- violate the series bible
- add character knowledge they did not acquire
- treat an unmentioned possession as lost
- duplicate an existing fact
- supersede an unknown fact

## Knowledge isolation

Narration and reader knowledge are not automatically character knowledge.

Example:

- The reader sees a fox hide a key.
- Theia and Juno do not see it.
- The continuity state may store the reader-visible fact separately, but neither child gains that knowledge.

## Possessions

Distinguish:

- owned
- carried
- stored at a location
- borrowed
- consumed
- lost
- destroyed
- given away

A plot-critical item should have an explicit state rather than a prose note.

## Snapshot strategy

Create one continuity snapshot after every accepted chapter revision.

Do not mutate historical snapshots.

Later regeneration rules:

- If no later chapters exist, a new accepted revision can produce a replacement snapshot chain from that point.
- If later chapters exist, the rewrite must preserve all facts relied upon later unless a full branch is deliberately created.

## Summaries

A human-readable recap may be generated for display, but it is not canonical continuity.

## Testing

Required tests include:

- possession transfer
- reader-only knowledge
- outfit changes
- temporary emotion
- location movement
- thread introduction and resolution
- superseded facts
- regeneration with later dependencies
- 20-chapter drift simulation

## Acceptance criteria

- A series can resume after days or months.
- Critical facts survive long series.
- Character knowledge remains isolated.
- Canonical state changes only through validated pure transitions.
- Historical snapshots remain available for debugging and regeneration.
