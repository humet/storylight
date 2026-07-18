/**
 * Private object-store key construction (`docs/05-backend/storage.md`
 * "Key structure"). Pure and shared by the application service (which builds a
 * key before upload) and the storage adapters. Non-guessable ids, never names.
 *
 * Character reference key scheme (EXACT):
 *   families/{familyId}/characters/{characterId}/profiles/{version}/{assetId}
 *
 * Every segment is validated to defend against path traversal
 * (`docs/05-backend/storage.md` "Security"): no slashes, no `.`/`..`, no empty
 * segments. A bad id throws rather than silently producing a traversing key.
 */

function assertSafeSegment(name: string, value: string): string {
  if (
    value.length === 0 ||
    value.includes("/") ||
    value.includes("\\") ||
    value === "." ||
    value === ".." ||
    value.includes("\0")
  ) {
    throw new Error(`Unsafe object-store key segment for ${name}: "${value}".`);
  }
  return value;
}

export interface VisualAssetKeyParts {
  familyId: string;
  characterId: string;
  /** The visual-profile version this asset belongs to (or is a candidate for). */
  version: number;
  assetId: string;
}

/** Build the private key for a character reference/candidate asset. */
export function buildVisualAssetKey(parts: VisualAssetKeyParts): string {
  const familyId = assertSafeSegment("familyId", parts.familyId);
  const characterId = assertSafeSegment("characterId", parts.characterId);
  const assetId = assertSafeSegment("assetId", parts.assetId);
  if (!Number.isInteger(parts.version) || parts.version < 1) {
    throw new Error(`Unsafe object-store key version: ${parts.version}.`);
  }
  return `families/${familyId}/characters/${characterId}/profiles/${parts.version}/${assetId}`;
}

/**
 * Chapter illustration key scheme (`docs/05-backend/storage.md` "Key structure",
 * chapter/revision scheme). Scoped to the family, story, chapter AND the immutable
 * chapter revision the illustration belongs to, so a superseded revision's images
 * never collide with a re-published one:
 *   families/{familyId}/stories/{storyId}/chapters/{chapterId}/revisions/{chapterRevisionId}/illustrations/{specId}/{assetId}
 */
export interface IllustrationAssetKeyParts {
  familyId: string;
  storyId: string;
  chapterId: string;
  chapterRevisionId: string;
  specId: string;
  assetId: string;
}

/** Build the private key for a chapter-illustration original/derivative asset. */
export function buildIllustrationAssetKey(
  parts: IllustrationAssetKeyParts,
): string {
  const familyId = assertSafeSegment("familyId", parts.familyId);
  const storyId = assertSafeSegment("storyId", parts.storyId);
  const chapterId = assertSafeSegment("chapterId", parts.chapterId);
  const chapterRevisionId = assertSafeSegment(
    "chapterRevisionId",
    parts.chapterRevisionId,
  );
  const specId = assertSafeSegment("specId", parts.specId);
  const assetId = assertSafeSegment("assetId", parts.assetId);
  return `families/${familyId}/stories/${storyId}/chapters/${chapterId}/revisions/${chapterRevisionId}/illustrations/${specId}/${assetId}`;
}
