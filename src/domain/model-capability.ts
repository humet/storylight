/**
 * The closed vocabulary of MODEL CAPABILITIES (`docs/03-ai/models.md`, ADR-004).
 *
 * Route by CAPABILITY, never by provider or model name — domain services request
 * a capability and the model registry resolves a concrete provider target. These
 * unions are the single source of the capability names; the capability registry
 * (`src/application/model-routes/capability-registry.ts`) layers descriptions and
 * routing metadata on top, and `model_route_versions.capability` is constrained to
 * the language set by a Postgres enum.
 *
 * Pure vocabulary only: no IO, no provider SDK. Kebab-case keys match the
 * `getLanguageRoute("chapter-writing", …)` example in `docs/03-ai/models.md`.
 */

/** Language (text) capabilities — the stages the M6 language adapter serves. */
export const LANGUAGE_CAPABILITIES = [
  "one-off-planning",
  "series-planning",
  "chapter-planning",
  "chapter-writing",
  "chapter-review",
  "chapter-revision",
  "continuity-extraction",
  "illustration-planning",
  "illustration-review",
] as const;

export type LanguageCapability = (typeof LANGUAGE_CAPABILITIES)[number];

/**
 * Image capabilities. Listed here for completeness of the routing vocabulary, but
 * image GENERATION stays on the M4 `ImageModel` port for now — see the
 * ImageModel/LanguageModel reconciliation note in `BUILD_STATE.md`. They are NOT
 * served by the M6 language adapter.
 */
export const IMAGE_CAPABILITIES = [
  "character-reference-generation",
  "style-reference-generation",
  "routine-chapter-illustration",
  "premium-chapter-illustration",
  "illustration-repair",
] as const;

export type ImageCapability = (typeof IMAGE_CAPABILITIES)[number];

export type ModelCapability = LanguageCapability | ImageCapability;

const LANGUAGE_SET: ReadonlySet<string> = new Set(LANGUAGE_CAPABILITIES);
const IMAGE_SET: ReadonlySet<string> = new Set(IMAGE_CAPABILITIES);

export function isLanguageCapability(
  value: string,
): value is LanguageCapability {
  return LANGUAGE_SET.has(value);
}

export function isImageCapability(value: string): value is ImageCapability {
  return IMAGE_SET.has(value);
}
