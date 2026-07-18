/**
 * Character keys are APP-GENERATED semantic identifiers — never a model- or
 * user-supplied id (M3 build note; AGENTS.md "Do not generate database IDs with
 * a model"). A key is a readable slug of the display name plus a short random
 * suffix that guarantees uniqueness within a family (the DB also enforces
 * `UNIQUE(family_id, character_key)`).
 *
 * The slug is a PURE function so it is deterministic and testable; the random
 * suffix is supplied by the caller (the application layer, which may touch
 * `crypto`) and composed here, keeping this module IO-free.
 */

// Combining diacritical marks (U+0300–U+036F) left behind by NFKD decomposition.
const COMBINING_MARKS = /[̀-ͯ]/g;

/** Turn a display name into a lowercase, hyphenated, ASCII-ish slug. */
export function slugifyName(displayName: string): string {
  const slug = displayName
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    // slicing may leave a trailing hyphen — trim it again.
    .replace(/-+$/g, "");
  // A name of only punctuation/emoji collapses to empty — fall back to a stable
  // stem so the key is never just the suffix.
  return slug.length > 0 ? slug : "character";
}

/**
 * Compose a full character key from a display name and a caller-supplied random
 * suffix (e.g. six lowercase base36 chars). Pure and deterministic given both
 * inputs.
 */
export function buildCharacterKey(displayName: string, suffix: string): string {
  return `${slugifyName(displayName)}-${suffix}`;
}
