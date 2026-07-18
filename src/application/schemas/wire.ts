import { z } from "zod";

/**
 * Building blocks for AI WIRE SCHEMAS (`docs/03-ai/structured-output.md`
 * "Zod rules"). A wire schema is provider-facing: strict objects, every string
 * and array bounded, closed vocabularies as enums, NO coercion / defaults /
 * transforms, and a `schemaVersion` on every root artifact. Wire schemas are the
 * second validation layer and are NEVER derived from a database table.
 *
 * Keep this module free of `.transform()`/`.default()`/`.coerce` so normalisation
 * stays OUT of provider-facing schemas (it happens after validation, in the
 * pipeline's `normalise` step).
 */

/**
 * A local SEMANTIC KEY — models emit these, never database IDs
 * (`structured-output.md` "IDs"). After validation the pipeline maps each key to
 * an application-generated id.
 */
export const SEMANTIC_KEY_REGEX = /^[a-z][a-z0-9-]{1,63}$/;

export function semanticKey() {
  return z.string().regex(SEMANTIC_KEY_REGEX);
}

/** A bounded, trimmed-length string (every generated string must be bounded). */
export function boundedString(min: number, max: number) {
  return z.string().min(min).max(max);
}

/**
 * A published, VERSIONED wire schema. `schemaVersion` is the immutable published
 * version recorded on every generation run and stored in `schema_versions`;
 * `name`/`description` are passed to `Output.object` as provider guidance and
 * must contain no provider names and no database IDs.
 */
export interface WireSchema<T> {
  /** Immutable published version, e.g. "synthetic-plan.v1". */
  schemaVersion: string;
  /** Output name (provider guidance). */
  name: string;
  /** Output description (provider guidance). */
  description: string;
  /** The strict Zod v4 schema that validates the provider output. */
  schema: z.ZodType<T>;
}
