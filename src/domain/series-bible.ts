import { invalidCommandError } from "@/lib/errors";
import type { StoryDna } from "./story-dna";

/**
 * SERIES BIBLE (`docs/02-storytelling/story-series.md`). The COMPLETE plan for a
 * series, generated and validated BEFORE Chapter 1 is written (domain rule 1). It
 * is spoiler-BEARING (internal synopsis, planned ending, future blueprints) and
 * must NEVER reach a child-facing payload (`story-series.md` "Spoilers"); only the
 * title, chapter count, and spoiler-free premise are parent/reader-visible.
 *
 * The bible is a validated MODEL output that becomes canonical planning context —
 * models never write it to canonical state directly (domain rule 3); the app
 * persists the accepted bible after structural + semantic validation. This module
 * is pure: domain types + a pure normalise + the structural/semantic validator.
 */

export interface SeriesLocation {
  /** Semantic location key — the continuity `locationId`. Never a database id. */
  key: string;
  name: string;
}

export interface SeriesCastMember {
  /** A Story DNA character key (the model references the supplied cast keys). */
  characterKey: string;
  role: string;
}

export interface SeriesPlotThread {
  threadKey: string;
  description: string;
  introduceInChapter: number;
  resolveInChapter: number;
  /** True for the thread(s) carrying the central question — must resolve at the end. */
  central: boolean;
}

export interface SeriesCharacterArc {
  characterKey: string;
  arc: string;
}

export interface ChapterBlueprintBeat {
  key: string;
  description: string;
}

export interface ChapterBlueprint {
  chapterNumber: number;
  narrativePurpose: string;
  openingState: string;
  localGoal: string;
  conflict: string;
  majorBeats: ChapterBlueprintBeat[];
  emotionalMovement: string;
  informationRevealed: string;
  threadsIntroduced: string[];
  threadsAdvanced: string[];
  threadsResolved: string[];
  closingState: string;
  /** The gentle anticipation for tomorrow (`story-series.md` chapter blueprint). */
  tomorrowPromise: string;
}

export interface SeriesFact {
  factKey: string;
  statement: string;
}

export interface SeriesBible {
  title: string;
  spoilerFreePremise: string;
  internalSynopsis: string;
  chapterCount: number;
  emotionalPromise: string;
  worldRules: string[];
  /** Story-local world locations (continuity vocabulary). */
  locations: SeriesLocation[];
  startingLocationKey: string;
  cast: SeriesCastMember[];
  centralQuestion: string;
  centralConflict: string;
  plannedEnding: string;
  characterArcs: SeriesCharacterArc[];
  plotThreads: SeriesPlotThread[];
  chapterBlueprints: ChapterBlueprint[];
  immutableFacts: SeriesFact[];
  forbiddenDevelopments: string[];
}

// --- Wire-like shape (structurally typed; domain never imports app schemas) ---

export interface SeriesBibleWireLike {
  schemaVersion: string;
  title: string;
  spoilerFreePremise: string;
  internalSynopsis: string;
  emotionalPromise: string;
  worldRules: string[];
  locations: { key: string; name: string }[];
  startingLocationKey: string;
  cast: { characterKey: string; role: string }[];
  centralQuestion: string;
  centralConflict: string;
  plannedEnding: string;
  characterArcs: { characterKey: string; arc: string }[];
  plotThreads: {
    threadKey: string;
    description: string;
    introduceInChapter: number;
    resolveInChapter: number;
    central: boolean;
  }[];
  chapterBlueprints: {
    chapterNumber: number;
    narrativePurpose: string;
    openingState: string;
    localGoal: string;
    conflict: string;
    majorBeats: { key: string; description: string }[];
    emotionalMovement: string;
    informationRevealed: string;
    threadsIntroduced: string[];
    threadsAdvanced: string[];
    threadsResolved: string[];
    closingState: string;
    tomorrowPromise: string;
  }[];
  immutableFacts: { factKey: string; statement: string }[];
  forbiddenDevelopments: string[];
}

function trimAll(values: string[]): string[] {
  return values.map((v) => v.trim()).filter((v) => v.length > 0);
}

/**
 * Normalise a validated series-bible wire object into the domain shape. The
 * `chapterCount` is a CANONICAL app value (from Story DNA), not a model field, so
 * the caller supplies it — the blueprint count is validated against it.
 */
export function normaliseSeriesBible(
  wire: SeriesBibleWireLike,
  chapterCount: number,
): SeriesBible {
  return {
    title: wire.title.trim(),
    spoilerFreePremise: wire.spoilerFreePremise.trim(),
    internalSynopsis: wire.internalSynopsis.trim(),
    chapterCount,
    emotionalPromise: wire.emotionalPromise.trim(),
    worldRules: trimAll(wire.worldRules),
    locations: wire.locations.map((l) => ({
      key: l.key,
      name: l.name.trim(),
    })),
    startingLocationKey: wire.startingLocationKey,
    cast: wire.cast.map((c) => ({
      characterKey: c.characterKey,
      role: c.role.trim(),
    })),
    centralQuestion: wire.centralQuestion.trim(),
    centralConflict: wire.centralConflict.trim(),
    plannedEnding: wire.plannedEnding.trim(),
    characterArcs: wire.characterArcs.map((a) => ({
      characterKey: a.characterKey,
      arc: a.arc.trim(),
    })),
    plotThreads: wire.plotThreads.map((t) => ({
      threadKey: t.threadKey,
      description: t.description.trim(),
      introduceInChapter: t.introduceInChapter,
      resolveInChapter: t.resolveInChapter,
      central: t.central,
    })),
    chapterBlueprints: wire.chapterBlueprints
      .slice()
      .sort((a, b) => a.chapterNumber - b.chapterNumber)
      .map((b) => ({
        chapterNumber: b.chapterNumber,
        narrativePurpose: b.narrativePurpose.trim(),
        openingState: b.openingState.trim(),
        localGoal: b.localGoal.trim(),
        conflict: b.conflict.trim(),
        majorBeats: b.majorBeats.map((beat) => ({
          key: beat.key,
          description: beat.description.trim(),
        })),
        emotionalMovement: b.emotionalMovement.trim(),
        informationRevealed: b.informationRevealed.trim(),
        threadsIntroduced: [...b.threadsIntroduced],
        threadsAdvanced: [...b.threadsAdvanced],
        threadsResolved: [...b.threadsResolved],
        closingState: b.closingState.trim(),
        tomorrowPromise: b.tomorrowPromise.trim(),
      })),
    immutableFacts: wire.immutableFacts.map((f) => ({
      factKey: f.factKey,
      statement: f.statement.trim(),
    })),
    forbiddenDevelopments: trimAll(wire.forbiddenDevelopments),
  };
}

// --- Cross-reference validation (against Story DNA) ---------------------

/** Reject a bible whose cast/arc keys aren't in the supplied Story DNA cast. */
export function crossReferenceSeriesBible(
  wire: SeriesBibleWireLike,
  dna: StoryDna,
): void {
  const castKeys = new Set(dna.characters.map((c) => c.key));
  for (const member of wire.cast) {
    if (!castKeys.has(member.characterKey)) {
      throw invalidCommandError({
        internalDetail: `Series cast references unknown character key "${member.characterKey}".`,
        stage: "series-bible.cross-reference",
      });
    }
  }
  for (const arc of wire.characterArcs) {
    if (!castKeys.has(arc.characterKey)) {
      throw invalidCommandError({
        internalDetail: `Character arc references unknown character key "${arc.characterKey}".`,
        stage: "series-bible.cross-reference",
      });
    }
  }
}

// --- Structural + semantic validation -----------------------------------

/**
 * Validate the accepted series bible (`story-series.md` "Series creation" step 4:
 * structural + semantic validation). Throws a safe INVALID_COMMAND on any breach
 * (the pipeline regenerates). Guarantees, before Chapter 1 is written:
 *
 *  - blueprints cover EXACTLY chapters 1..chapterCount (contiguous, unique);
 *  - every plot thread is INTRODUCED and RESOLVED within the plan, at consistent
 *    chapters, with introduce ≤ resolve;
 *  - the blueprints' thread transitions are consistent with the thread plan;
 *  - the FINAL chapter resolves the central question (every central thread
 *    resolves in the last chapter, and no thread is left dangling);
 *  - locations/starting location are known; each blueprint has beats.
 */
export function validateSeriesBible(bible: SeriesBible): void {
  const n = bible.chapterCount;
  const fail = (detail: string): never => {
    throw invalidCommandError({
      internalDetail: detail,
      stage: "series-bible.validate",
    });
  };

  if (n < 1) fail(`Series chapter count ${n} is invalid.`);
  if (bible.chapterBlueprints.length !== n) {
    fail(
      `Series has ${bible.chapterBlueprints.length} blueprints for a ${n}-chapter series.`,
    );
  }

  // Blueprints cover exactly 1..n, contiguous + unique.
  const seenChapters = new Set<number>();
  for (const bp of bible.chapterBlueprints) {
    if (bp.chapterNumber < 1 || bp.chapterNumber > n) {
      fail(`Blueprint chapter number ${bp.chapterNumber} is outside 1..${n}.`);
    }
    if (seenChapters.has(bp.chapterNumber)) {
      fail(`Duplicate blueprint for chapter ${bp.chapterNumber}.`);
    }
    seenChapters.add(bp.chapterNumber);
    if (bp.majorBeats.length === 0) {
      fail(`Blueprint for chapter ${bp.chapterNumber} has no major beats.`);
    }
    if (bp.tomorrowPromise.length === 0 && bp.chapterNumber < n) {
      fail(
        `Blueprint for chapter ${bp.chapterNumber} is missing a tomorrow promise.`,
      );
    }
  }
  for (let c = 1; c <= n; c++) {
    if (!seenChapters.has(c)) fail(`No blueprint for chapter ${c}.`);
  }

  // Locations.
  const locationKeys = new Set(bible.locations.map((l) => l.key));
  if (!locationKeys.has(bible.startingLocationKey)) {
    fail(
      `Starting location "${bible.startingLocationKey}" is not among the declared locations.`,
    );
  }

  // Plot-thread plan.
  const threadKeys = new Set<string>();
  for (const thread of bible.plotThreads) {
    if (threadKeys.has(thread.threadKey)) {
      fail(`Duplicate plot thread "${thread.threadKey}".`);
    }
    threadKeys.add(thread.threadKey);
    if (
      thread.introduceInChapter < 1 ||
      thread.introduceInChapter > n ||
      thread.resolveInChapter < 1 ||
      thread.resolveInChapter > n
    ) {
      fail(`Plot thread "${thread.threadKey}" has out-of-range chapters.`);
    }
    if (thread.resolveInChapter < thread.introduceInChapter) {
      fail(
        `Plot thread "${thread.threadKey}" resolves (${thread.resolveInChapter}) before it is introduced (${thread.introduceInChapter}).`,
      );
    }
  }

  // Blueprint thread transitions must reference known threads and be consistent
  // with the thread plan.
  const introducedByPlan = new Map(
    bible.plotThreads.map((t) => [t.threadKey, t.introduceInChapter]),
  );
  const resolvedByPlan = new Map(
    bible.plotThreads.map((t) => [t.threadKey, t.resolveInChapter]),
  );
  const introducedInBlueprint = new Set<string>();
  const resolvedInBlueprint = new Set<string>();
  for (const bp of bible.chapterBlueprints) {
    for (const key of [
      ...bp.threadsIntroduced,
      ...bp.threadsAdvanced,
      ...bp.threadsResolved,
    ]) {
      if (!threadKeys.has(key)) {
        fail(
          `Blueprint for chapter ${bp.chapterNumber} references unknown thread "${key}".`,
        );
      }
    }
    for (const key of bp.threadsIntroduced) {
      if (introducedByPlan.get(key) !== bp.chapterNumber) {
        fail(
          `Thread "${key}" is introduced in chapter ${bp.chapterNumber} but the plan introduces it in chapter ${introducedByPlan.get(key)}.`,
        );
      }
      introducedInBlueprint.add(key);
    }
    for (const key of bp.threadsResolved) {
      if (resolvedByPlan.get(key) !== bp.chapterNumber) {
        fail(
          `Thread "${key}" is resolved in chapter ${bp.chapterNumber} but the plan resolves it in chapter ${resolvedByPlan.get(key)}.`,
        );
      }
      resolvedInBlueprint.add(key);
    }
  }

  // Every planned thread is introduced AND resolved somewhere in the blueprints.
  for (const thread of bible.plotThreads) {
    if (!introducedInBlueprint.has(thread.threadKey)) {
      fail(`Thread "${thread.threadKey}" is never introduced by a blueprint.`);
    }
    if (!resolvedInBlueprint.has(thread.threadKey)) {
      fail(`Thread "${thread.threadKey}" is never resolved by a blueprint.`);
    }
  }

  // The FINAL chapter resolves the central question.
  const centralThreads = bible.plotThreads.filter((t) => t.central);
  if (centralThreads.length === 0) {
    fail("No central plot thread carries the central question.");
  }
  for (const thread of centralThreads) {
    if (thread.resolveInChapter !== n) {
      fail(
        `Central thread "${thread.threadKey}" must resolve in the final chapter ${n}, not ${thread.resolveInChapter}.`,
      );
    }
  }
  if (bible.plannedEnding.length === 0) {
    fail("The bible has no planned ending.");
  }
}

/** The blueprint for a chapter number, or throws a safe error if absent. */
export function blueprintForChapter(
  bible: SeriesBible,
  chapterNumber: number,
): ChapterBlueprint {
  const blueprint = bible.chapterBlueprints.find(
    (b) => b.chapterNumber === chapterNumber,
  );
  if (!blueprint) {
    throw invalidCommandError({
      internalDetail: `No blueprint for chapter ${chapterNumber}.`,
      stage: "series-bible.blueprint",
    });
  }
  return blueprint;
}
