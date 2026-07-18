import { z } from "zod";

import { boundedString, semanticKey, type WireSchema } from "./wire";

/**
 * SERIES BIBLE wire schema (`docs/02-storytelling/story-series.md` "Series Bible
 * contents"). The series-planning stage produces the COMPLETE plan for a series
 * before Chapter 1 (domain rule 1). Strict object, bounded strings/arrays, semantic
 * keys (never database ids), `schemaVersion` on the root. `chapterCount` is a
 * CANONICAL app value (from the parent's 5/10 choice), NOT a model field — the
 * blueprint count is validated against it after normalisation.
 *
 * This artifact is spoiler-BEARING; the pipeline persists it as the internal
 * accepted bible and NEVER returns it to a child-facing payload (`story-series.md`
 * "Spoilers").
 */

const SCHEMA_VERSION = "series-bible.v1";

const LocationWireSchema = z.strictObject({
  key: semanticKey(),
  name: boundedString(1, 120),
});

const CastWireSchema = z.strictObject({
  characterKey: semanticKey(),
  role: boundedString(1, 200),
});

const ArcWireSchema = z.strictObject({
  characterKey: semanticKey(),
  arc: boundedString(1, 400),
});

const ThreadWireSchema = z.strictObject({
  threadKey: semanticKey(),
  description: boundedString(1, 400),
  introduceInChapter: z.number().int().min(1).max(20),
  resolveInChapter: z.number().int().min(1).max(20),
  central: z.boolean(),
});

const BlueprintBeatWireSchema = z.strictObject({
  key: semanticKey(),
  description: boundedString(1, 400),
});

const BlueprintWireSchema = z.strictObject({
  chapterNumber: z.number().int().min(1).max(20),
  narrativePurpose: boundedString(1, 400),
  openingState: boundedString(1, 400),
  localGoal: boundedString(1, 400),
  conflict: boundedString(1, 400),
  majorBeats: z.array(BlueprintBeatWireSchema).min(1).max(10),
  emotionalMovement: boundedString(1, 400),
  informationRevealed: boundedString(1, 600),
  threadsIntroduced: z.array(semanticKey()).max(12),
  threadsAdvanced: z.array(semanticKey()).max(12),
  threadsResolved: z.array(semanticKey()).max(12),
  closingState: boundedString(1, 400),
  tomorrowPromise: boundedString(1, 300),
});

const FactWireSchema = z.strictObject({
  factKey: semanticKey(),
  statement: boundedString(1, 400),
});

export const SeriesBibleArtifactV1 = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  title: boundedString(1, 120),
  spoilerFreePremise: boundedString(1, 400),
  internalSynopsis: boundedString(1, 2000),
  emotionalPromise: boundedString(1, 400),
  worldRules: z.array(boundedString(1, 400)).min(1).max(12),
  locations: z.array(LocationWireSchema).min(1).max(24),
  startingLocationKey: semanticKey(),
  cast: z.array(CastWireSchema).min(1).max(8),
  centralQuestion: boundedString(1, 400),
  centralConflict: boundedString(1, 400),
  plannedEnding: boundedString(1, 800),
  characterArcs: z.array(ArcWireSchema).min(1).max(8),
  plotThreads: z.array(ThreadWireSchema).min(1).max(16),
  chapterBlueprints: z.array(BlueprintWireSchema).min(1).max(20),
  immutableFacts: z.array(FactWireSchema).max(24),
  forbiddenDevelopments: z.array(boundedString(1, 300)).max(16),
});

export type SeriesBibleWire = z.infer<typeof SeriesBibleArtifactV1>;

export const seriesBibleWireSchema: WireSchema<SeriesBibleWire> = {
  schemaVersion: SCHEMA_VERSION,
  name: "StorylightSeriesBible",
  description:
    "A complete plan for a bedtime series before any chapter is written: title, spoiler-free premise, internal synopsis, emotional promise, world rules, locations, cast, central question and conflict, planned ending, character arcs, plot threads, one blueprint per chapter, immutable facts, and forbidden developments.",
  schema: SeriesBibleArtifactV1,
};
