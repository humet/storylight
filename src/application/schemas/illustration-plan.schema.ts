import { z } from "zod";

import { TIMES_OF_DAY } from "@/domain/image-request";
import { boundedString, semanticKey, type WireSchema } from "./wire";

/**
 * ILLUSTRATION PLAN wire schema (`docs/02-storytelling/story-engine.md`
 * "Illustration plan"; `docs/03-ai/image-generation.md`). Each spec references a
 * draft illustration anchor by key. The one-off pipeline and the series shared
 * chapter stages both produce plans through this schema.
 *
 * Strict object, closed aspect enum, bounded strings/arrays, `schemaVersion`.
 *
 * VERSIONS (RULE 8 — never mutate a published version in place):
 *  - `v1` (M7): {anchorKey, caption, sceneDescription, aspect}. Kept as an
 *    immutable record; existing rows / pinned series validated under it stay valid.
 *  - `v2` (ADR-008 parts 3–4): adds OPTIONAL `companions` (recurring non-child
 *    character descriptors — key + species + appearance) and OPTIONAL `setting`
 *    (location + closed-enum time-of-day). v2 is a strict SUPERSET of v1: a v1-shaped
 *    plan validates under v2 (the new fields are optional), so the model may declare
 *    a cast + setting that become canonical when the app persists the validated
 *    artifact — the sanctioned path (models never write canonical state directly).
 *    Kept as an immutable record.
 *  - `v3` (ADR-008 part 2): adds plan-level OPTIONAL `wardrobeStates` (the child's
 *    wardrobe STATES declared ONCE for the story — key + short appearance; `everyday`
 *    is reserved/implicit and may not be redeclared) and a per-scene OPTIONAL
 *    `wardrobe` state-KEY reference (defaults to `everyday`). v3 is a strict SUPERSET
 *    of v2: a v2/v1-shaped plan validates under v3 (the new fields are optional), so
 *    a scene with no wardrobe reads back as `everyday` — deterministic safe absence
 *    (the everyday outfit reference is used, no directive, review compares against it
 *    exactly as before part 2). The pipeline uses v3 for all NEW generation; the
 *    schema-version pins recorded on a series remain provenance records (the M6/M8
 *    machinery uses the source-controlled active schema, not a runtime resolver).
 */

const SCHEMA_VERSION_V1 = "illustration-plan.v1";
const SCHEMA_VERSION_V2 = "illustration-plan.v2";
const SCHEMA_VERSION_V3 = "illustration-plan.v3";

const AspectWireSchema = z.enum(["portrait", "landscape", "square"]);

// --- v1 (immutable published record) ------------------------------------

const SpecWireSchemaV1 = z.strictObject({
  /** References a draft illustration-anchor key. */
  anchorKey: semanticKey(),
  caption: boundedString(1, 200),
  sceneDescription: boundedString(1, 600),
  aspect: AspectWireSchema,
});

export const IllustrationPlanArtifactV1 = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION_V1),
  illustrations: z.array(SpecWireSchemaV1).max(5),
});

// --- shared field schemas (ADR-008) -------------------------------------

/**
 * A recurring NON-child companion the model DECLARES for a scene (ADR-008 part 3,
 * descriptor level): a semantic `key`, its `species` (the enforced visual fact),
 * and a short `appearance`. No image anchor — that is a deferred follow-up.
 */
const CompanionWireSchema = z.strictObject({
  key: semanticKey(),
  species: boundedString(1, 60),
  appearance: boundedString(1, 200),
});

/** The declared canonical setting: a short location + a closed-enum time-of-day. */
const SettingWireSchema = z.strictObject({
  location: boundedString(1, 120),
  timeOfDay: z.enum(TIMES_OF_DAY),
});

/**
 * A declared WARDROBE STATE (ADR-008 part 2): a semantic `key` (e.g. `pyjamas`,
 * `raincoat`) + a short `appearance`. Declared ONCE at story level; the reserved
 * `everyday` key may not appear here (rejected in domain cross-reference).
 */
const WardrobeStateWireSchema = z.strictObject({
  key: semanticKey(),
  appearance: boundedString(1, 200),
});

// --- v2 (immutable published record; ADR-008 parts 3–4) -----------------

const SpecWireSchemaV2 = z.strictObject({
  anchorKey: semanticKey(),
  caption: boundedString(1, 200),
  sceneDescription: boundedString(1, 600),
  aspect: AspectWireSchema,
  /** Optional (safe absence): recurring non-child characters in this scene. */
  companions: z.array(CompanionWireSchema).max(6).optional(),
  /** Optional (safe absence): the scene's canonical location + time-of-day. */
  setting: SettingWireSchema.optional(),
});

export const IllustrationPlanArtifactV2 = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION_V2),
  illustrations: z.array(SpecWireSchemaV2).max(5),
});

// --- v3 (active; ADR-008 part 2 — per-scene wardrobe states) ------------

const SpecWireSchemaV3 = z.strictObject({
  anchorKey: semanticKey(),
  caption: boundedString(1, 200),
  sceneDescription: boundedString(1, 600),
  aspect: AspectWireSchema,
  companions: z.array(CompanionWireSchema).max(6).optional(),
  setting: SettingWireSchema.optional(),
  /**
   * Optional (safe absence): the wardrobe STATE-KEY the child wears in this scene.
   * Must be `everyday` (reserved) or a key declared in plan-level `wardrobeStates`
   * (enforced in domain cross-reference). Absent ⇒ `everyday`.
   */
  wardrobe: semanticKey().optional(),
});

export const IllustrationPlanArtifactV3 = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION_V3),
  illustrations: z.array(SpecWireSchemaV3).max(5),
  /**
   * Optional (safe absence): the child's wardrobe STATES for the whole story,
   * declared ONCE (max 4). Each scene references one by key. `everyday` is reserved.
   */
  wardrobeStates: z.array(WardrobeStateWireSchema).max(4).optional(),
});

export type IllustrationPlanWire = z.infer<typeof IllustrationPlanArtifactV3>;

/**
 * The ACTIVE illustration-plan wire schema the pipeline resolves for new
 * generation (v3). v1/v2 remain exported as immutable records.
 */
export const illustrationPlanWireSchema: WireSchema<IllustrationPlanWire> = {
  schemaVersion: SCHEMA_VERSION_V3,
  name: "StorylightIllustrationPlan",
  description:
    "A plan for a story's illustrations: for each marked anchor, a short caption, a scene description, an aspect ratio, and — where the scene has them — the recurring non-child companions (name/species/appearance), the setting (location + time of day), and the child's wardrobe. Declare the child's wardrobe STATES once at story level (each a key + appearance) and reference one per scene; scenes with no wardrobe are the everyday outfit. No images are generated at this stage.",
  schema: IllustrationPlanArtifactV3,
};
