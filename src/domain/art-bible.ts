/**
 * The ART BIBLE (`docs/03-ai/image-generation.md` "Art Bible"). The MVP supports
 * exactly ONE approved style, captured here as a VERSIONED, immutable record that
 * the deterministic prompt builder consumes. It is pure domain data — no provider
 * prompt, no SDK — so a given `IllustrationSpec` + Art Bible version always builds
 * the same model-neutral image request (ADR-003).
 *
 * The version string matches the character reference `ART_BIBLE_VERSION`
 * (`visual-asset.ts`) so a story's character references and its chapter scenes are
 * rendered under one coherent style. Existing series pin this version (rule 8).
 */

export interface ArtBible {
  /** Immutable published version (matches `ART_BIBLE_VERSION`). */
  version: string;
  /** Painterly medium — the dominant style directive. */
  medium: string;
  /** Positive style qualities the prompt asserts. */
  qualities: readonly string[];
  /** Hard prohibitions the prompt forbids (never photorealism / 3D / text). */
  prohibitions: readonly string[];
}

/**
 * The single MVP style: premium digital gouache, warm lighting, storybook
 * proportions, clear faces, rich-but-uncluttered backgrounds. No photorealism, no
 * glossy 3D, no named living-artist imitation, no text rendered in the image.
 */
export const MVP_ART_BIBLE: ArtBible = {
  version: "mvp-gouache-v1",
  medium: "premium digital gouache children's-book illustration",
  qualities: [
    "warm expressive lighting",
    "gentle storybook proportions",
    "clear, kind faces",
    "rich but uncluttered backgrounds",
    "soft painterly texture",
  ],
  prohibitions: [
    "no photorealism",
    "no glossy 3D render",
    "no named living-artist imitation",
    "no text or lettering rendered in the image",
    "no frightening or unsafe imagery",
  ],
} as const;

/** Resolve an Art Bible by version. MVP has exactly one; unknown versions throw. */
export function artBibleForVersion(version: string): ArtBible {
  if (version === MVP_ART_BIBLE.version) return MVP_ART_BIBLE;
  throw new Error(`Unknown Art Bible version "${version}".`);
}
