import { z } from "zod";

import { boundedString, semanticKey, type WireSchema } from "./wire";

/**
 * ONE-OFF PLAN wire schema (`docs/02-storytelling/one-off-stories.md` "Planning";
 * `docs/03-ai/structured-output.md`). The planning stage elaborates the canonical
 * Story DNA into a complete plan BEFORE any prose is written (domain rule 1 for
 * one-offs; `story-engine.md`). Strict object, bounded strings/arrays, semantic
 * keys (never database ids), `schemaVersion` on the root.
 *
 * The plan carries exactly the documented plan fields: setting, protagonist
 * desire, obstacle, emotional theme, 6–10 beats, climax, resolution, calming
 * close. Prohibited outcomes are CANONICAL input (Story DNA), so the model does
 * not emit them.
 */

const SCHEMA_VERSION = "one-off-plan.v1";

const BeatWireSchema = z.strictObject({
  key: semanticKey(),
  description: boundedString(1, 400),
});

export const OneOffPlanArtifactV1 = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  title: boundedString(1, 120),
  setting: boundedString(1, 400),
  /** References one of the canonical Story DNA character keys. */
  protagonistKey: semanticKey(),
  protagonistDesire: boundedString(1, 400),
  obstacle: boundedString(1, 400),
  emotionalTheme: boundedString(1, 200),
  beats: z.array(BeatWireSchema).min(6).max(10),
  climax: boundedString(1, 600),
  resolution: boundedString(1, 600),
  calmingClose: boundedString(1, 600),
});

export type OneOffPlanWire = z.infer<typeof OneOffPlanArtifactV1>;

export const oneOffPlanWireSchema: WireSchema<OneOffPlanWire> = {
  schemaVersion: SCHEMA_VERSION,
  name: "StorylightOneOffPlan",
  description:
    "A complete plan for a single bedtime story: title, setting, the protagonist's desire and obstacle, an emotional theme, 6 to 10 ordered beats, a climax, a resolution, and a calming close.",
  schema: OneOffPlanArtifactV1,
};
