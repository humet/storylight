import type { PromptAsset } from "./prompt-asset";
import { syntheticPlanningPrompt } from "./synthetic-planning.prompt";

/**
 * The PROMPT REGISTRY: source-controlled prompt assets keyed by `purpose@version`
 * (`docs/03-ai/prompts.md` "Versioning"). Published versions are immutable; a new
 * revision is a NEW version entry, never an edit of an existing one. The registry
 * is the single place the pipeline resolves a prompt, and `prompt_versions`
 * records each published `(purpose, version)`.
 *
 * Registering a prompt is one line; snapshot tests (`registry.test.ts`) assert no
 * unresolved variables, no provider names, and no database ids across all assets.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- assets have heterogeneous Ctx/Untrusted types; the registry is a type-erased lookup, callers hold the concrete asset for type-safe `build`.
type AnyPromptAsset = PromptAsset<any, any>;

const ASSETS: readonly AnyPromptAsset[] = [syntheticPlanningPrompt];

function keyOf(purpose: string, version: string): string {
  return `${purpose}@${version}`;
}

const BY_KEY = new Map<string, AnyPromptAsset>(
  ASSETS.map((a) => [keyOf(a.purpose, a.version), a]),
);

/** All published prompt assets (used by seeding + snapshot tests). */
export function listPromptAssets(): readonly AnyPromptAsset[] {
  return ASSETS;
}

/** Resolve a specific published prompt version. Throws when unknown. */
export function getPromptAsset(
  purpose: string,
  version: string,
): AnyPromptAsset {
  const asset = BY_KEY.get(keyOf(purpose, version));
  if (!asset) {
    throw new Error(`No prompt asset registered for ${purpose}@${version}.`);
  }
  return asset;
}
