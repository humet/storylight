import { z } from "zod";

import { boundedString, semanticKey, type WireSchema } from "./wire";

/**
 * ILLUSTRATION PLAN wire schema (`docs/02-storytelling/story-engine.md`
 * "Illustration plan"; `docs/03-ai/image-generation.md`). In M7 the one-off
 * pipeline persists an illustration PLAN only — specifications, no image bytes;
 * generation is M9. Each spec references a draft illustration anchor by key.
 *
 * Strict object, closed aspect enum, bounded strings/arrays, `schemaVersion`.
 */

const SCHEMA_VERSION = "illustration-plan.v1";

const SpecWireSchema = z.strictObject({
  /** References a draft illustration-anchor key. */
  anchorKey: semanticKey(),
  caption: boundedString(1, 200),
  sceneDescription: boundedString(1, 600),
  aspect: z.enum(["portrait", "landscape", "square"]),
});

export const IllustrationPlanArtifactV1 = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  illustrations: z.array(SpecWireSchema).max(5),
});

export type IllustrationPlanWire = z.infer<typeof IllustrationPlanArtifactV1>;

export const illustrationPlanWireSchema: WireSchema<IllustrationPlanWire> = {
  schemaVersion: SCHEMA_VERSION,
  name: "StorylightIllustrationPlan",
  description:
    "A plan for a story's illustrations: for each marked anchor, a short caption, a scene description, and an aspect ratio. No images are generated at this stage.",
  schema: IllustrationPlanArtifactV1,
};
