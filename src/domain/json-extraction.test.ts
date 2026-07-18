import { describe, expect, it } from "vitest";

import { extractBalancedJsonObject, safeParseJson } from "./json-extraction";

describe("safeParseJson", () => {
  it("parses valid JSON and never throws on invalid", () => {
    expect(safeParseJson('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(safeParseJson("not json")).toEqual({ ok: false });
  });
});

describe("extractBalancedJsonObject", () => {
  it("extracts an object wrapped in prose / code fences (syntax repair)", () => {
    const text = 'Sure!\n```json\n{"a":1,"b":{"c":2}}\n```\nDone.';
    expect(extractBalancedJsonObject(text)).toEqual({
      ok: true,
      value: { a: 1, b: { c: 2 } },
    });
  });

  it("ignores braces INSIDE string values", () => {
    const text = 'prefix {"note":"a } b { c","n":1} suffix';
    expect(extractBalancedJsonObject(text)).toEqual({
      ok: true,
      value: { note: "a } b { c", n: 1 },
    });
  });

  it("returns not-ok for a TRUNCATED object (never invents a close)", () => {
    expect(extractBalancedJsonObject('{"a":1,"b":')).toEqual({ ok: false });
  });

  it("returns not-ok when there is no object at all", () => {
    expect(extractBalancedJsonObject("[1,2,3]")).toEqual({ ok: false });
  });
});
