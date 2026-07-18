import type { LanguageCapability } from "@/domain/model-capability";

/**
 * A PROMPT ASSET (`docs/03-ai/prompts.md`): a source-controlled, semantically
 * versioned prompt with ONE narrow responsibility. It knows how to turn trusted
 * canonical context + untrusted narrative input into a concrete `{ system,
 * prompt }` pair — the system message carries global policy + stage authority +
 * output requirements; the user message carries the `<storylight_request>`
 * envelope.
 *
 * `Ctx`/`Untrusted` are the asset's own typed inputs so context builders select
 * the MINIMUM necessary data (`prompts.md` "Context construction"). Every
 * generation run records `purpose` + `version`; published versions are immutable
 * (`prompt_versions`).
 */
export interface BuiltPrompt {
  system: string;
  prompt: string;
}

export interface PromptAsset<Ctx = unknown, Untrusted = unknown> {
  /** Narrow purpose, e.g. "synthetic-planning". Stable across versions. */
  purpose: string;
  /** Semantic version, e.g. "1.0.0". `(purpose, version)` is immutable. */
  version: string;
  /** The capability this prompt serves (routes the model). */
  capability: LanguageCapability;
  /** Build the concrete messages. Pure: same inputs → same strings. */
  build(input: {
    canonicalContext: Ctx;
    untrustedInput: Untrusted;
  }): BuiltPrompt;
}
