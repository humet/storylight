import { z } from "zod";

import {
  PLOT_THREAD_STATUSES,
  POSSESSION_STATES,
  RELATIONSHIP_STANDINGS,
} from "@/domain/continuity";
import { boundedString, semanticKey, type WireSchema } from "./wire";

/**
 * CONTINUITY CHANGE SET wire schema (`docs/02-storytelling/continuity.md`
 * "Change-set pattern"). The continuity-extraction stage proposes the CHANGES a
 * chapter made — it NEVER returns the next canonical state (domain rule 3).
 * Application code validates references, rejects contradictions, and applies the
 * change set through the pure `applyContinuityChanges` to produce the immutable
 * snapshot. Strict object, bounded strings/arrays, closed enums, `schemaVersion`.
 *
 * Nullable values are used consistently (`structured-output.md` "Zod rules"): a
 * null `currentTime`/`currentLocationId` means "unchanged"; a null counterparty /
 * locationId is only meaningful for the states that use them.
 */

const SCHEMA_VERSION = "continuity-change.v1";

const PossessionChangeSchema = z.strictObject({
  itemKey: semanticKey(),
  name: boundedString(1, 120),
  characterKey: semanticKey(),
  to: z.enum(POSSESSION_STATES),
  counterpartyKey: semanticKey().nullable(),
  locationId: semanticKey().nullable(),
});

export const ContinuityChangeArtifactV1 = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  currentTime: boundedString(1, 120).nullable(),
  currentLocationId: semanticKey().nullable(),
  characterMoves: z
    .array(
      z.strictObject({
        characterKey: semanticKey(),
        toLocationId: semanticKey(),
      }),
    )
    .max(16),
  emotionChanges: z
    .array(
      z.strictObject({
        characterKey: semanticKey(),
        emotion: boundedString(1, 120).nullable(),
      }),
    )
    .max(16),
  outfitChanges: z
    .array(
      z.strictObject({
        characterKey: semanticKey(),
        outfitKey: semanticKey(),
        description: boundedString(1, 300),
      }),
    )
    .max(16),
  possessionChanges: z.array(PossessionChangeSchema).max(24),
  knowledgeGains: z
    .array(
      z.strictObject({
        characterKey: semanticKey(),
        fact: boundedString(1, 300),
      }),
    )
    .max(24),
  readerKnowledgeGains: z.array(boundedString(1, 300)).max(24),
  relationshipChanges: z
    .array(
      z.strictObject({
        characterKey: semanticKey(),
        withCharacterKey: semanticKey(),
        standing: z.enum(RELATIONSHIP_STANDINGS),
        note: boundedString(1, 300).nullable(),
      }),
    )
    .max(24),
  temporaryConditionChanges: z
    .array(
      z.strictObject({
        characterKey: semanticKey(),
        condition: boundedString(1, 120),
        add: z.boolean(),
      }),
    )
    .max(24),
  threadTransitions: z
    .array(
      z.strictObject({
        threadKey: semanticKey(),
        to: z.enum(PLOT_THREAD_STATUSES),
      }),
    )
    .max(24),
  locationDiscoveries: z
    .array(
      z.strictObject({
        locationId: semanticKey(),
        note: boundedString(1, 300).nullable(),
      }),
    )
    .max(16),
  newFacts: z
    .array(
      z.strictObject({
        factKey: semanticKey(),
        statement: boundedString(1, 400),
        immutable: z.boolean(),
      }),
    )
    .max(24),
  supersededFacts: z
    .array(
      z.strictObject({
        factKey: semanticKey(),
        bySupersedingFactKey: semanticKey(),
      }),
    )
    .max(24),
});

export type ContinuityChangeWire = z.infer<typeof ContinuityChangeArtifactV1>;

export const continuityChangeWireSchema: WireSchema<ContinuityChangeWire> = {
  schemaVersion: SCHEMA_VERSION,
  name: "StorylightContinuityChange",
  description:
    "The structured changes a chapter made to series continuity: time and location movement, emotions, outfits, possessions, per-character and reader-only knowledge, relationships, temporary conditions, plot-thread transitions, discoveries, and new or superseded facts. Never the full next state.",
  schema: ContinuityChangeArtifactV1,
};
