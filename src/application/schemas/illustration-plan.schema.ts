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
 *    The pipeline uses v2 for all NEW generation; the schema-version pins recorded
 *    on a series remain provenance records (the established M6/M8 machinery uses the
 *    source-controlled active schema, not a runtime version resolver). A published
 *    v1 spec read back downstream carries no companions + no setting ⇒ deterministic
 *    safe absence (no directive emitted, review skips the new checks).
 */

const SCHEMA_VERSION_V1 = "illustration-plan.v1";
const SCHEMA_VERSION_V2 = "illustration-plan.v2";

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

// --- v2 (active; ADR-008 parts 3–4) -------------------------------------

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

export type IllustrationPlanWire = z.infer<typeof IllustrationPlanArtifactV2>;

/**
 * The ACTIVE illustration-plan wire schema the pipeline resolves for new
 * generation (v2). v1 remains exported as an immutable record.
 */
export const illustrationPlanWireSchema: WireSchema<IllustrationPlanWire> = {
  schemaVersion: SCHEMA_VERSION_V2,
  name: "StorylightIllustrationPlan",
  description:
    "A plan for a story's illustrations: for each marked anchor, a short caption, a scene description, an aspect ratio, and — where the scene has them — the recurring non-child companions (name/species/appearance) and the setting (location + time of day). No images are generated at this stage.",
  schema: IllustrationPlanArtifactV2,
};
