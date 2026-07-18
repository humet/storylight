import { z } from "zod";

import { boundedString, semanticKey, type WireSchema } from "./wire";

/**
 * A SYNTHETIC planning wire schema used to exercise the full structured-output
 * pipeline in M6 (parse → wire-validate → normalise → cross-reference validate →
 * domain validate → persist) WITHOUT pre-building M7's real Story-DNA / one-off
 * plan schema (deferred to M7 per ADR-006 appendix). It is deliberately shaped to
 * stress every pipeline stage: bounded strings, bounded arrays, semantic keys the
 * pipeline maps to ids, and beats that CROSS-REFERENCE character keys so an
 * unknown reference is rejected.
 *
 * Strict object, no coercion/defaults/transforms, `schemaVersion` on the root.
 */

const SCHEMA_VERSION = "synthetic-plan.v1";

const CharacterWireSchema = z.strictObject({
  key: semanticKey(),
  name: boundedString(1, 80),
});

const BeatWireSchema = z.strictObject({
  key: semanticKey(),
  /** Must reference one of the plan's character keys (cross-reference check). */
  characterKey: semanticKey(),
  action: boundedString(1, 200),
});

export const SyntheticPlanArtifactV1 = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  title: boundedString(1, 120),
  summary: boundedString(1, 600),
  characters: z.array(CharacterWireSchema).min(1).max(6),
  beats: z.array(BeatWireSchema).min(1).max(12),
});

export type SyntheticPlanWire = z.infer<typeof SyntheticPlanArtifactV1>;

export const syntheticPlanWireSchema: WireSchema<SyntheticPlanWire> = {
  schemaVersion: SCHEMA_VERSION,
  name: "StorylightSyntheticPlan",
  description:
    "A small story plan: a title, a summary, a cast of characters keyed by local keys, and ordered beats that each reference a character by key.",
  schema: SyntheticPlanArtifactV1,
};
