import { describe, expect, it } from "vitest";

import { MVP_ART_BIBLE } from "./art-bible";
import { buildImageSceneRequest, resolveDimensions } from "./image-request";
import type { SelectedReference } from "./reference-selection";

/**
 * The prompt builder is pure + deterministic (ADR-003): APPLICATION CODE builds a
 * model-neutral request; the model never chooses references. Snapshot-style.
 */

const references: SelectedReference[] = [
  {
    slot: "identity",
    assetId: "rosa-front",
    characterKey: "rosa",
    view: "front-portrait",
  },
];

describe("resolveDimensions", () => {
  it("uses 4:3 landscape at 2K for a chapter scene", () => {
    expect(resolveDimensions("landscape", "chapter")).toEqual({
      width: 2048,
      height: 1536,
    });
  });

  it("uses 3:4 portrait for a portrait chapter scene", () => {
    expect(resolveDimensions("portrait", "chapter")).toEqual({
      width: 1536,
      height: 2048,
    });
  });

  it("uses 2:3 for a cover regardless of the spec aspect", () => {
    expect(resolveDimensions("landscape", "cover")).toEqual({
      width: 1365,
      height: 2048,
    });
  });
});

describe("buildImageSceneRequest", () => {
  const base = {
    spec: { scene: "  Rosa lifts the lantern  ", aspect: "landscape" as const },
    artBible: MVP_ART_BIBLE,
    placements: [{ characterKey: "rosa", prominent: true }],
    references,
    continuityNotes: ["  wears the red coat  ", ""],
    seed: 42,
  };

  it("is deterministic and carries the Art Bible + references + trimmed scene", () => {
    const a = buildImageSceneRequest(base);
    const b = buildImageSceneRequest(base);
    expect(a).toEqual(b);
    expect(a.artBibleVersion).toBe("mvp-gouache-v1");
    expect(a.styleDirectives[0]).toBe(MVP_ART_BIBLE.medium);
    expect(a.prohibitions).toContain(
      "no text or lettering rendered in the image",
    );
    expect(a.scene).toBe("Rosa lifts the lantern");
    expect(a.continuityNotes).toEqual(["wears the red coat"]);
    expect(a.references).toEqual(references);
    expect(a.dimensions).toEqual({ width: 2048, height: 1536 });
    expect(a.repairInstruction).toBeUndefined();
  });

  it("includes a repair instruction only when supplied (targeted repair)", () => {
    const repaired = buildImageSceneRequest({
      ...base,
      repairInstruction: "  fix the face  ",
    });
    expect(repaired.repairInstruction).toBe("fix the face");
  });
});
