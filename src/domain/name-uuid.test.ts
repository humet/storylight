import { describe, expect, it } from "vitest";

import { nameBasedUuid } from "./name-uuid";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("nameBasedUuid", () => {
  it("is deterministic for the same parts", async () => {
    const a = await nameBasedUuid("wf-1", "paint-candidates", "0");
    const b = await nameBasedUuid("wf-1", "paint-candidates", "0");
    expect(a).toBe(b);
  });

  it("produces a well-formed v5-shaped UUID (version 5, RFC variant)", async () => {
    const id = await nameBasedUuid("wf-1", "paint-candidates", "0");
    expect(id).toMatch(UUID_RE);
  });

  it("differs when any part differs", async () => {
    const base = await nameBasedUuid("wf-1", "paint-candidates", "0");
    expect(await nameBasedUuid("wf-1", "paint-candidates", "1")).not.toBe(base);
    expect(await nameBasedUuid("wf-2", "paint-candidates", "0")).not.toBe(base);
    expect(await nameBasedUuid("wf-1", "other-stage", "0")).not.toBe(base);
  });

  it("does not collide across ambiguous part boundaries", async () => {
    // NUL separation means ["a","bc"] and ["ab","c"] hash distinctly.
    expect(await nameBasedUuid("a", "bc")).not.toBe(
      await nameBasedUuid("ab", "c"),
    );
  });
});
