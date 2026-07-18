import { describe, expect, it } from "vitest";

import { buildCharacterKey, slugifyName } from "./character-key";

/**
 * Character keys are app-generated semantic slugs, never model/user ids. These
 * pin the slug rules so a key stays readable, stable, and safe to place in a
 * URL or a `UNIQUE(family_id, character_key)` constraint.
 */
describe("slugifyName", () => {
  it("lowercases and hyphenates a plain name", () => {
    expect(slugifyName("Rosa Marie")).toBe("rosa-marie");
  });

  it("strips diacritics and punctuation", () => {
    expect(slugifyName("Zoë O'Brien!")).toBe("zoe-o-brien");
  });

  it("falls back to a stable stem when nothing slug-able remains", () => {
    expect(slugifyName("🙂🙂")).toBe("character");
    expect(slugifyName("   ")).toBe("character");
  });

  it("never ends in a trailing hyphen", () => {
    expect(slugifyName("Max---")).toBe("max");
  });
});

describe("buildCharacterKey", () => {
  it("composes a slug with a caller-supplied suffix", () => {
    expect(buildCharacterKey("Rosa", "a1b2c3")).toBe("rosa-a1b2c3");
  });

  it("is deterministic given the same inputs", () => {
    expect(buildCharacterKey("Rosa", "zzz")).toBe(
      buildCharacterKey("Rosa", "zzz"),
    );
  });
});
