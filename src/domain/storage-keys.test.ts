import { describe, expect, it } from "vitest";

import { buildVisualAssetKey } from "./storage-keys";

/**
 * The key scheme is fixed by `docs/05-backend/storage.md`, and building it must
 * refuse path-traversal attempts ("Prevent path traversal"). These tests pin
 * both the exact format and the rejection of unsafe segments.
 */
describe("buildVisualAssetKey", () => {
  it("builds the exact documented key scheme", () => {
    expect(
      buildVisualAssetKey({
        familyId: "fam-1",
        characterId: "char-2",
        version: 3,
        assetId: "asset-4",
      }),
    ).toBe("families/fam-1/characters/char-2/profiles/3/asset-4");
  });

  it.each([
    { familyId: "../etc", characterId: "c", version: 1, assetId: "a" },
    { familyId: "f", characterId: "c/d", version: 1, assetId: "a" },
    { familyId: "f", characterId: "c", version: 1, assetId: ".." },
    { familyId: "", characterId: "c", version: 1, assetId: "a" },
    { familyId: "f", characterId: "c", version: 0, assetId: "a" },
    { familyId: "f", characterId: "c", version: 1.5, assetId: "a" },
  ])("rejects an unsafe key input %#", (parts) => {
    expect(() => buildVisualAssetKey(parts)).toThrow();
  });
});
