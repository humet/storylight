import { invalidCommandError } from "@/lib/errors";

/**
 * CONTINUITY — the structured canonical state that keeps a series coherent across
 * nights WITHOUT relying on model memory or a growing transcript
 * (`docs/02-storytelling/continuity.md`; domain rules 1–5). It is the single
 * source of truth for "what is true right now" in a series.
 *
 * The `ContinuityState` interface is verbatim from `continuity.md`; the sub-types
 * it references but never defines are derived here from the doc's "Continuity
 * layers" (immutable facts, current state, per-character + reader knowledge,
 * relationships, plot threads, visual continuity) and recorded in `BUILD_STATE.md`.
 *
 * The ONLY way canonical continuity advances is the pure {@link applyContinuityChanges}:
 * a model proposes a wire-validated {@link ContinuityChangeSet} (it NEVER returns
 * the next state, domain rule 3); application code validates references, REJECTS
 * contradictions (a rejection triggers regeneration, not repair —
 * `structured-output.md`), applies the change set through this pure function, and
 * persists an immutable snapshot. This module is pure: types + guarded pure
 * transitions, no IO, no provider SDK.
 */

// --- Plot threads -------------------------------------------------------

/** Plot-thread lifecycle (`continuity.md` "Plot threads"). Forward-only. */
export type PlotThreadStatus =
  "planned" | "introduced" | "developing" | "resolved";

export const PLOT_THREAD_STATUSES: readonly PlotThreadStatus[] = [
  "planned",
  "introduced",
  "developing",
  "resolved",
];

const PLOT_THREAD_RANK: Record<PlotThreadStatus, number> = {
  planned: 0,
  introduced: 1,
  developing: 2,
  resolved: 3,
};

/**
 * The allowed plot-thread transitions. A thread must be INTRODUCED before it can
 * develop or resolve (so "resolve an unintroduced thread" is rejected), and it can
 * never REGRESS (a resolved thread cannot re-open — that would "regress a resolved
 * thread"). Staying in the same status is a no-op, handled by the caller.
 */
const PLOT_THREAD_EDGES: Record<
  PlotThreadStatus,
  ReadonlySet<PlotThreadStatus>
> = {
  planned: new Set<PlotThreadStatus>(["introduced"]),
  introduced: new Set<PlotThreadStatus>(["developing", "resolved"]),
  developing: new Set<PlotThreadStatus>(["resolved"]),
  resolved: new Set<PlotThreadStatus>([]),
};

export interface PlotThreadContinuityState {
  threadKey: string;
  status: PlotThreadStatus;
  /** Chapter the thread was introduced in (null while still planned). */
  introducedInChapter: number | null;
  /** Chapter the thread resolved in (null until resolved). */
  resolvedInChapter: number | null;
}

/**
 * Advance a plot thread's status through a GUARDED transition. Throws on an
 * illegal move (regression, resolving an unintroduced thread, or an impossible
 * skip) so the change set is rejected and regenerated.
 */
export function advancePlotThread(
  from: PlotThreadStatus,
  to: PlotThreadStatus,
): PlotThreadStatus {
  if (from === to) return to;
  if (PLOT_THREAD_RANK[to] < PLOT_THREAD_RANK[from]) {
    throw invalidCommandError({
      internalDetail: `Plot thread regression from "${from}" to "${to}" is not allowed.`,
      stage: "continuity.thread",
    });
  }
  if (!PLOT_THREAD_EDGES[from].has(to)) {
    throw invalidCommandError({
      internalDetail: `Illegal plot-thread transition "${from}" → "${to}" (a thread must be introduced before it develops or resolves).`,
      stage: "continuity.thread",
    });
  }
  return to;
}

// --- Possessions --------------------------------------------------------

/** Possession states (`continuity.md` "Possessions"). */
export type PossessionState =
  | "owned"
  | "carried"
  | "stored"
  | "borrowed"
  | "consumed"
  | "lost"
  | "destroyed"
  | "given-away";

export const POSSESSION_STATES: readonly PossessionState[] = [
  "owned",
  "carried",
  "stored",
  "borrowed",
  "consumed",
  "lost",
  "destroyed",
  "given-away",
];

/** A possession state in which the item is STILL in the character's hands. */
const HELD_STATES: ReadonlySet<PossessionState> = new Set<PossessionState>([
  "owned",
  "carried",
  "borrowed",
]);

/** A possession state that ENDS a character's relationship with the item. */
const REMOVAL_STATES: ReadonlySet<PossessionState> = new Set<PossessionState>([
  "consumed",
  "lost",
  "destroyed",
  "given-away",
]);

export function isHeldPossessionState(state: PossessionState): boolean {
  return HELD_STATES.has(state);
}

export interface PossessionRecord {
  itemKey: string;
  name: string;
  state: PossessionState;
  /** For `stored`: the location the item rests at. */
  locationId: string | null;
}

// --- Relationships ------------------------------------------------------

/** Meaningful relationship standing (`continuity.md` "Relationships"). */
export type RelationshipStanding =
  "warm" | "neutral" | "strained" | "trusting" | "reconciled";

export const RELATIONSHIP_STANDINGS: readonly RelationshipStanding[] = [
  "warm",
  "neutral",
  "strained",
  "trusting",
  "reconciled",
];

export interface RelationshipState {
  withCharacterKey: string;
  standing: RelationshipStanding;
  note: string | null;
}

// --- Characters ---------------------------------------------------------

export interface CharacterContinuityState {
  characterKey: string;
  currentLocationId: string | null;
  /** TEMPORARY emotion — current-state layer, cleared/overwritten freely. */
  currentEmotion: string | null;
  /** Active outfit key (visual continuity pointer). */
  currentOutfitKey: string | null;
  /** Facts THIS character knows — ISOLATED from reader knowledge. */
  knowledge: string[];
  /** Temporary conditions (e.g. "tired", "wet"). */
  temporaryConditions: string[];
  /** Items keyed by itemKey (owned/carried/borrowed/…). */
  possessions: Record<string, PossessionRecord>;
  /** Meaningful relationship states keyed by the other character key. */
  relationships: Record<string, RelationshipState>;
}

// --- World --------------------------------------------------------------

export interface WorldLocationContinuity {
  locationId: string;
  discovered: boolean;
  note: string | null;
}

export interface WorldContinuityState {
  locations: Record<string, WorldLocationContinuity>;
  /**
   * Facts the READER has seen but that NO character necessarily knows
   * (`continuity.md` "Knowledge isolation": the reader sees the fox hide the key;
   * the children do not). Stored separately and NEVER merged into character
   * knowledge by this module.
   */
  readerKnowledge: string[];
}

// --- Facts --------------------------------------------------------------

export interface ContinuityFact {
  factKey: string;
  statement: string;
  /** Immutable series facts can never be superseded (`continuity.md`). */
  immutable: boolean;
  establishedInChapter: number;
  /** Set when a later (mutable) fact supersedes this one. */
  supersededByFactKey: string | null;
}

// --- Visual continuity --------------------------------------------------

export interface VisualOutfit {
  outfitKey: string;
  characterKey: string;
  description: string;
}

export interface VisualContinuityState {
  outfits: Record<string, VisualOutfit>;
  props: Record<string, string>;
  locationVersions: Record<string, string>;
  temporaryAppearanceChanges: { characterKey: string; change: string }[];
  creatureReferences: Record<string, string>;
}

// --- Canonical model (verbatim from continuity.md) ----------------------

export interface ContinuityState {
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

// --- Change set (the model's proposal) ----------------------------------

export interface ContinuityChangeSet {
  schemaVersion: "continuity-change.v1";
  /** New time-of-day/season, or null to keep the current value. */
  currentTime: string | null;
  /** New party location, or null to keep the current value. */
  currentLocationId: string | null;
  characterMoves: { characterKey: string; toLocationId: string }[];
  emotionChanges: { characterKey: string; emotion: string | null }[];
  outfitChanges: {
    characterKey: string;
    outfitKey: string;
    description: string;
  }[];
  possessionChanges: {
    itemKey: string;
    name: string;
    characterKey: string;
    to: PossessionState;
    counterpartyKey: string | null;
    locationId: string | null;
  }[];
  /** Per-character knowledge gains (isolated from reader knowledge). */
  knowledgeGains: { characterKey: string; fact: string }[];
  /** Reader-only knowledge gains (never added to any character). */
  readerKnowledgeGains: string[];
  relationshipChanges: {
    characterKey: string;
    withCharacterKey: string;
    standing: RelationshipStanding;
    note: string | null;
  }[];
  temporaryConditionChanges: {
    characterKey: string;
    condition: string;
    add: boolean;
  }[];
  threadTransitions: { threadKey: string; to: PlotThreadStatus }[];
  locationDiscoveries: { locationId: string; note: string | null }[];
  newFacts: { factKey: string; statement: string; immutable: boolean }[];
  supersededFacts: { factKey: string; bySupersedingFactKey: string }[];
}

/**
 * NORMALISE a validated continuity-change wire object into the domain change set.
 * The wire shape and the domain {@link ContinuityChangeSet} are identical by
 * construction, so this is a defensive deep copy (the pipeline never re-uses the
 * mutable wire object afterwards). Trims free-text values.
 */
export function normaliseContinuityChange(
  wire: ContinuityChangeSet,
): ContinuityChangeSet {
  return {
    schemaVersion: "continuity-change.v1",
    currentTime: wire.currentTime?.trim() ?? null,
    currentLocationId: wire.currentLocationId,
    characterMoves: wire.characterMoves.map((m) => ({ ...m })),
    emotionChanges: wire.emotionChanges.map((e) => ({
      characterKey: e.characterKey,
      emotion: e.emotion?.trim() ?? null,
    })),
    outfitChanges: wire.outfitChanges.map((o) => ({
      ...o,
      description: o.description.trim(),
    })),
    possessionChanges: wire.possessionChanges.map((p) => ({
      ...p,
      name: p.name.trim(),
    })),
    knowledgeGains: wire.knowledgeGains.map((g) => ({
      characterKey: g.characterKey,
      fact: g.fact.trim(),
    })),
    readerKnowledgeGains: wire.readerKnowledgeGains.map((f) => f.trim()),
    relationshipChanges: wire.relationshipChanges.map((r) => ({
      ...r,
      note: r.note?.trim() ?? null,
    })),
    temporaryConditionChanges: wire.temporaryConditionChanges.map((c) => ({
      ...c,
      condition: c.condition.trim(),
    })),
    threadTransitions: wire.threadTransitions.map((t) => ({ ...t })),
    locationDiscoveries: wire.locationDiscoveries.map((d) => ({
      locationId: d.locationId,
      note: d.note?.trim() ?? null,
    })),
    newFacts: wire.newFacts.map((f) => ({
      ...f,
      statement: f.statement.trim(),
    })),
    supersededFacts: wire.supersededFacts.map((s) => ({ ...s })),
  };
}

/**
 * Cross-reference a continuity change set for LOCAL contradictions the pure apply
 * would also catch, but which are cheaper to surface here as a wire-level reject
 * (→ regenerate): a `stored` possession with no location, and a `given-away`/
 * `borrowed` with no counterparty.
 */
export function crossReferenceContinuityChange(
  wire: ContinuityChangeSet,
): void {
  for (const p of wire.possessionChanges) {
    if (p.to === "stored" && !p.locationId) {
      throw invalidCommandError({
        internalDetail: `Possession "${p.itemKey}" is "stored" without a locationId.`,
        stage: "continuity.cross-reference",
      });
    }
    if ((p.to === "given-away" || p.to === "borrowed") && !p.counterpartyKey) {
      throw invalidCommandError({
        internalDetail: `Possession "${p.itemKey}" is "${p.to}" without a counterparty.`,
        stage: "continuity.cross-reference",
      });
    }
  }
}

// --- Initial state ------------------------------------------------------

/**
 * The empty continuity state a series starts from (before Chapter 1). It seeds the
 * known cast and the series' immutable facts + starting location from the bible.
 */
export function createInitialContinuityState(input: {
  seriesId: string;
  characterKeys: string[];
  startingLocationId: string;
  startingTime: string;
  knownLocationIds: string[];
  immutableFacts: { factKey: string; statement: string }[];
}): ContinuityState {
  const characters: Record<string, CharacterContinuityState> = {};
  for (const key of input.characterKeys) {
    characters[key] = {
      characterKey: key,
      currentLocationId: input.startingLocationId,
      currentEmotion: null,
      currentOutfitKey: null,
      knowledge: [],
      temporaryConditions: [],
      possessions: {},
      relationships: {},
    };
  }
  const locations: Record<string, WorldLocationContinuity> = {};
  for (const id of input.knownLocationIds) {
    locations[id] = {
      locationId: id,
      discovered: id === input.startingLocationId,
      note: null,
    };
  }
  return {
    schemaVersion: "1.0",
    seriesId: input.seriesId,
    afterChapterNumber: 0,
    currentTime: input.startingTime,
    currentLocationId: input.startingLocationId,
    characters,
    world: { locations, readerKnowledge: [] },
    plotThreads: {},
    establishedFacts: input.immutableFacts.map((f) => ({
      factKey: f.factKey,
      statement: f.statement,
      immutable: true,
      establishedInChapter: 0,
      supersededByFactKey: null,
    })),
    visual: {
      outfits: {},
      props: {},
      locationVersions: {},
      temporaryAppearanceChanges: [],
      creatureReferences: {},
    },
  };
}

// --- Deep clone (pure) --------------------------------------------------

function cloneCharacter(c: CharacterContinuityState): CharacterContinuityState {
  return {
    characterKey: c.characterKey,
    currentLocationId: c.currentLocationId,
    currentEmotion: c.currentEmotion,
    currentOutfitKey: c.currentOutfitKey,
    knowledge: [...c.knowledge],
    temporaryConditions: [...c.temporaryConditions],
    possessions: Object.fromEntries(
      Object.entries(c.possessions).map(([k, v]) => [k, { ...v }]),
    ),
    relationships: Object.fromEntries(
      Object.entries(c.relationships).map(([k, v]) => [k, { ...v }]),
    ),
  };
}

function cloneState(state: ContinuityState): ContinuityState {
  return {
    schemaVersion: state.schemaVersion,
    seriesId: state.seriesId,
    afterChapterNumber: state.afterChapterNumber,
    currentTime: state.currentTime,
    currentLocationId: state.currentLocationId,
    characters: Object.fromEntries(
      Object.entries(state.characters).map(([k, v]) => [k, cloneCharacter(v)]),
    ),
    world: {
      locations: Object.fromEntries(
        Object.entries(state.world.locations).map(([k, v]) => [k, { ...v }]),
      ),
      readerKnowledge: [...state.world.readerKnowledge],
    },
    plotThreads: Object.fromEntries(
      Object.entries(state.plotThreads).map(([k, v]) => [k, { ...v }]),
    ),
    establishedFacts: state.establishedFacts.map((f) => ({ ...f })),
    visual: {
      outfits: Object.fromEntries(
        Object.entries(state.visual.outfits).map(([k, v]) => [k, { ...v }]),
      ),
      props: { ...state.visual.props },
      locationVersions: { ...state.visual.locationVersions },
      temporaryAppearanceChanges: state.visual.temporaryAppearanceChanges.map(
        (t) => ({ ...t }),
      ),
      creatureReferences: { ...state.visual.creatureReferences },
    },
  };
}

// --- The pure transition ------------------------------------------------

function requireCharacter(
  state: ContinuityState,
  key: string,
  what: string,
): CharacterContinuityState {
  const character = state.characters[key];
  if (!character) {
    throw invalidCommandError({
      internalDetail: `${what} references unknown character "${key}".`,
      stage: "continuity.reference",
    });
  }
  return character;
}

function requireLocation(
  state: ContinuityState,
  id: string,
  what: string,
): void {
  if (!state.world.locations[id]) {
    throw invalidCommandError({
      internalDetail: `${what} references unknown location "${id}".`,
      stage: "continuity.reference",
    });
  }
}

/**
 * Apply a validated change set to the previous continuity state, returning the
 * NEW immutable state for `chapterNumber`. PURE: no mutation of `previous`, no IO.
 *
 * Validation rejects the contradictions listed in `continuity.md` "Validation
 * rules": unknown characters/locations, removing an object not held, resolving an
 * unintroduced thread, regressing a resolved thread, changing an immutable fact,
 * adding reader-only knowledge to characters, duplicating a fact, superseding an
 * unknown or immutable fact. A rejection throws a safe INVALID_COMMAND, which the
 * pipeline classifies as domain-invalid and REGENERATES (continuity extraction
 * favours regeneration over repair).
 */
export function applyContinuityChanges(
  previous: ContinuityState,
  changes: ContinuityChangeSet,
  chapterNumber: number,
): ContinuityState {
  const next = cloneState(previous);
  next.afterChapterNumber = chapterNumber;

  // Party time + location.
  if (changes.currentTime !== null) next.currentTime = changes.currentTime;
  if (changes.currentLocationId !== null) {
    requireLocation(next, changes.currentLocationId, "currentLocationId");
    next.currentLocationId = changes.currentLocationId;
  }

  // Location discoveries first, so subsequent moves may reference them.
  for (const d of changes.locationDiscoveries) {
    const existing = next.world.locations[d.locationId];
    if (existing) {
      existing.discovered = true;
      if (d.note !== null) existing.note = d.note;
    } else {
      next.world.locations[d.locationId] = {
        locationId: d.locationId,
        discovered: true,
        note: d.note,
      };
    }
  }

  // Character moves.
  for (const m of changes.characterMoves) {
    const character = requireCharacter(next, m.characterKey, "characterMoves");
    requireLocation(next, m.toLocationId, "characterMoves");
    character.currentLocationId = m.toLocationId;
  }

  // Temporary emotions (current-state layer — overwrites freely).
  for (const e of changes.emotionChanges) {
    const character = requireCharacter(next, e.characterKey, "emotionChanges");
    character.currentEmotion = e.emotion;
  }

  // Outfit changes (current outfit pointer + visual outfit record).
  for (const o of changes.outfitChanges) {
    const character = requireCharacter(next, o.characterKey, "outfitChanges");
    character.currentOutfitKey = o.outfitKey;
    next.visual.outfits[o.outfitKey] = {
      outfitKey: o.outfitKey,
      characterKey: o.characterKey,
      description: o.description,
    };
  }

  // Temporary conditions.
  for (const c of changes.temporaryConditionChanges) {
    const character = requireCharacter(
      next,
      c.characterKey,
      "temporaryConditionChanges",
    );
    if (c.add) {
      if (!character.temporaryConditions.includes(c.condition)) {
        character.temporaryConditions.push(c.condition);
      }
    } else {
      character.temporaryConditions = character.temporaryConditions.filter(
        (x) => x !== c.condition,
      );
    }
  }

  // Possessions — the most-guarded layer.
  for (const p of changes.possessionChanges) {
    const subject = requireCharacter(next, p.characterKey, "possessionChanges");
    const current = subject.possessions[p.itemKey];

    if (REMOVAL_STATES.has(p.to)) {
      // "remove an object not held": a removal requires the subject to CURRENTLY
      // hold the item.
      if (!current || !HELD_STATES.has(current.state)) {
        throw invalidCommandError({
          internalDetail: `Cannot set possession "${p.itemKey}" to "${p.to}" for "${p.characterKey}" — it is not currently held.`,
          stage: "continuity.possession",
        });
      }
      subject.possessions[p.itemKey] = {
        ...current,
        state: p.to,
        locationId: null,
      };
      if (p.to === "given-away") {
        // Transfer: the counterparty gains it as owned.
        if (!p.counterpartyKey) {
          throw invalidCommandError({
            internalDetail: `"given-away" of "${p.itemKey}" requires a counterparty.`,
            stage: "continuity.possession",
          });
        }
        const counterparty = requireCharacter(
          next,
          p.counterpartyKey,
          "possessionChanges.counterparty",
        );
        counterparty.possessions[p.itemKey] = {
          itemKey: p.itemKey,
          name: p.name,
          state: "owned",
          locationId: null,
        };
      }
      continue;
    }

    if (p.to === "borrowed") {
      // Borrowing requires a lender who currently holds the item.
      if (!p.counterpartyKey) {
        throw invalidCommandError({
          internalDetail: `"borrowed" of "${p.itemKey}" requires a counterparty (the lender).`,
          stage: "continuity.possession",
        });
      }
      const lender = requireCharacter(
        next,
        p.counterpartyKey,
        "possessionChanges.lender",
      );
      const lent = lender.possessions[p.itemKey];
      if (!lent || !HELD_STATES.has(lent.state)) {
        throw invalidCommandError({
          internalDetail: `Cannot borrow "${p.itemKey}" from "${p.counterpartyKey}" — the lender does not hold it.`,
          stage: "continuity.possession",
        });
      }
      lender.possessions[p.itemKey] = {
        ...lent,
        state: "lost",
        locationId: null,
      };
    }

    // Acquire / set a held-or-stored state (owned/carried/stored/borrowed).
    subject.possessions[p.itemKey] = {
      itemKey: p.itemKey,
      name: p.name,
      state: p.to,
      locationId: p.to === "stored" ? p.locationId : null,
    };
  }

  // Per-character knowledge gains (isolated).
  for (const g of changes.knowledgeGains) {
    const character = requireCharacter(next, g.characterKey, "knowledgeGains");
    if (!character.knowledge.includes(g.fact)) {
      character.knowledge.push(g.fact);
    }
  }

  // Reader-only knowledge — NEVER added to any character.
  for (const fact of changes.readerKnowledgeGains) {
    if (!next.world.readerKnowledge.includes(fact)) {
      next.world.readerKnowledge.push(fact);
    }
  }

  // Relationships.
  for (const r of changes.relationshipChanges) {
    const character = requireCharacter(
      next,
      r.characterKey,
      "relationshipChanges",
    );
    requireCharacter(next, r.withCharacterKey, "relationshipChanges.with");
    character.relationships[r.withCharacterKey] = {
      withCharacterKey: r.withCharacterKey,
      standing: r.standing,
      note: r.note,
    };
  }

  // Plot-thread transitions (guarded lifecycle).
  for (const t of changes.threadTransitions) {
    const existing = next.plotThreads[t.threadKey] ?? {
      threadKey: t.threadKey,
      status: "planned" as PlotThreadStatus,
      introducedInChapter: null,
      resolvedInChapter: null,
    };
    const nextStatus = advancePlotThread(existing.status, t.to);
    const introducedInChapter =
      existing.introducedInChapter ??
      (nextStatus !== "planned" ? chapterNumber : null);
    const resolvedInChapter =
      nextStatus === "resolved"
        ? (existing.resolvedInChapter ?? chapterNumber)
        : existing.resolvedInChapter;
    next.plotThreads[t.threadKey] = {
      threadKey: t.threadKey,
      status: nextStatus,
      introducedInChapter,
      resolvedInChapter,
    };
  }

  // New facts (duplicate → reject).
  const factByKey = new Map(next.establishedFacts.map((f) => [f.factKey, f]));
  for (const f of changes.newFacts) {
    if (factByKey.has(f.factKey)) {
      throw invalidCommandError({
        internalDetail: `Duplicate established fact "${f.factKey}".`,
        stage: "continuity.fact",
      });
    }
    const fact: ContinuityFact = {
      factKey: f.factKey,
      statement: f.statement,
      immutable: f.immutable,
      establishedInChapter: chapterNumber,
      supersededByFactKey: null,
    };
    next.establishedFacts.push(fact);
    factByKey.set(f.factKey, fact);
  }

  // Superseded facts (unknown → reject; immutable → reject).
  for (const s of changes.supersededFacts) {
    const target = factByKey.get(s.factKey);
    if (!target) {
      throw invalidCommandError({
        internalDetail: `Cannot supersede unknown fact "${s.factKey}".`,
        stage: "continuity.fact",
      });
    }
    if (target.immutable) {
      throw invalidCommandError({
        internalDetail: `Cannot supersede immutable fact "${s.factKey}".`,
        stage: "continuity.fact",
      });
    }
    if (!factByKey.has(s.bySupersedingFactKey)) {
      throw invalidCommandError({
        internalDetail: `Superseding fact "${s.bySupersedingFactKey}" for "${s.factKey}" does not exist.`,
        stage: "continuity.fact",
      });
    }
    target.supersededByFactKey = s.bySupersedingFactKey;
  }

  return next;
}

// --- Regeneration guard -------------------------------------------------

/**
 * The set of ESTABLISHED FACT KEYS that later snapshots rely upon
 * (`continuity.md` "Later regeneration rules": if later chapters exist, a rewrite
 * must preserve all facts relied upon later). The union of every non-superseded
 * fact present in a later snapshot.
 */
export function dependentFactKeys(
  laterSnapshots: ContinuityState[],
): Set<string> {
  const keys = new Set<string>();
  for (const snapshot of laterSnapshots) {
    for (const fact of snapshot.establishedFacts) {
      if (fact.supersededByFactKey === null) keys.add(fact.factKey);
    }
  }
  return keys;
}

/**
 * Guard a regenerated snapshot against LATER dependencies. When later chapters
 * exist, the replacement must preserve every fact those chapters rely upon; this
 * throws when a depended-upon fact is missing (a deliberate branch is a separate,
 * explicit operation). With no later snapshots it is a no-op — a chapter with no
 * successors may be freely regenerated with a new chain.
 */
export function assertRegenerationPreservesDependencies(
  replacement: ContinuityState,
  laterSnapshots: ContinuityState[],
): void {
  const required = dependentFactKeys(laterSnapshots);
  const present = new Set(replacement.establishedFacts.map((f) => f.factKey));
  for (const key of required) {
    if (!present.has(key)) {
      throw invalidCommandError({
        safeMessage:
          "This chapter can't be regenerated without changing later chapters.",
        internalDetail: `Regeneration would drop fact "${key}" that a later chapter relies upon.`,
        stage: "continuity.regeneration",
      });
    }
  }
}

// --- Recap (display only, NOT canonical) --------------------------------

/**
 * A compact, human-readable recap of the state for the NEXT chapter's context
 * (`continuity.md` "Summaries": a recap may be generated for display or context,
 * but it is not canonical continuity). Pure projection over the canonical state.
 */
export function continuitySummary(state: ContinuityState): {
  afterChapterNumber: number;
  currentTime: string;
  currentLocationId: string;
  characters: {
    characterKey: string;
    currentLocationId: string | null;
    currentEmotion: string | null;
    heldItems: string[];
    knows: string[];
  }[];
  openThreads: { threadKey: string; status: PlotThreadStatus }[];
  facts: string[];
} {
  return {
    afterChapterNumber: state.afterChapterNumber,
    currentTime: state.currentTime,
    currentLocationId: state.currentLocationId,
    characters: Object.values(state.characters).map((c) => ({
      characterKey: c.characterKey,
      currentLocationId: c.currentLocationId,
      currentEmotion: c.currentEmotion,
      heldItems: Object.values(c.possessions)
        .filter((p) => isHeldPossessionState(p.state))
        .map((p) => p.name),
      knows: [...c.knowledge],
    })),
    openThreads: Object.values(state.plotThreads)
      .filter((t) => t.status !== "resolved")
      .map((t) => ({ threadKey: t.threadKey, status: t.status })),
    facts: state.establishedFacts
      .filter((f) => f.supersededByFactKey === null)
      .map((f) => f.statement),
  };
}
