import { describe, expect, it } from "vitest";

import { parseVisionVerdict } from "./vision-verdict-parse";

const VALID = {
  identityByChild: [{ characterKey: "ivy", matches: true }],
  observedCount: 1,
  outfitConsistent: true,
  propConsistent: true,
  toneAppropriate: true,
  styleConsistent: true,
  notes: "looks good",
};

describe("parseVisionVerdict", () => {
  it("parses a bare JSON object", () => {
    expect(parseVisionVerdict(JSON.stringify(VALID))).toMatchObject(VALID);
  });

  it("parses JSON inside markdown code fences", () => {
    const fenced = "```json\n" + JSON.stringify(VALID) + "\n```";
    expect(parseVisionVerdict(fenced)?.observedCount).toBe(1);
  });

  it("parses JSON surrounded by prose (the common failure of Output.object)", () => {
    const text = `Here is my review of the illustration:\n${JSON.stringify(VALID)}\nHope that helps!`;
    expect(parseVisionVerdict(text)?.identityByChild[0]?.matches).toBe(true);
  });

  it("tolerates braces inside string values", () => {
    const withBrace = { ...VALID, notes: "child holds a {lantern}" };
    expect(parseVisionVerdict(JSON.stringify(withBrace))?.notes).toBe(
      "child holds a {lantern}",
    );
  });

  it("returns null when no JSON object is present", () => {
    expect(parseVisionVerdict("I cannot review this image.")).toBeNull();
  });

  it("returns null when JSON is present but fails the schema", () => {
    const bad = JSON.stringify({ observedCount: "one", foo: true });
    expect(parseVisionVerdict(bad)).toBeNull();
  });

  it("returns null on malformed JSON", () => {
    expect(parseVisionVerdict('{"observedCount": 1,')).toBeNull();
  });
});
