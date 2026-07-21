import { describe, expect, it } from "vitest";

import { MVP_ART_BIBLE } from "./art-bible";
import {
  buildImageSceneRequest,
  describeCastForPrompt,
  describeCompanionsForPrompt,
  describeSettingForPrompt,
  describeWardrobeForPrompt,
  describeWardrobeForReview,
  isEverydayWardrobe,
  referencesForWardrobe,
  resolveDimensions,
  type SceneWardrobe,
} from "./image-request";
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

  it("defaults to an empty cast when none is supplied", () => {
    expect(buildImageSceneRequest(base).cast).toEqual({ children: [] });
  });

  it("carries the canonical cast with trimmed display names (ADR-008)", () => {
    const withCast = buildImageSceneRequest({
      ...base,
      cast: {
        children: [{ characterKey: "rosa", displayName: "  Rosa  " }],
      },
    });
    expect(withCast.cast).toEqual({
      children: [{ characterKey: "rosa", displayName: "Rosa" }],
    });
  });

  it("defaults companions to empty and omits setting when none supplied", () => {
    const r = buildImageSceneRequest(base);
    expect(r.companions).toEqual([]);
    expect(r.setting).toBeUndefined();
  });

  it("carries trimmed companions + setting when supplied (ADR-008 parts 3–4)", () => {
    const r = buildImageSceneRequest({
      ...base,
      companions: [
        { key: "pip", species: "  owl  ", appearance: "  grey owlet  " },
      ],
      setting: { location: "  the garden  ", timeOfDay: "dusk" },
    });
    expect(r.companions).toEqual([
      { key: "pip", species: "owl", appearance: "grey owlet" },
    ]);
    expect(r.setting).toEqual({ location: "the garden", timeOfDay: "dusk" });
  });
});

describe("describeCastForPrompt (ADR-008 part 1: named exact-count directive)", () => {
  it("returns no directive for an empty cast", () => {
    expect(describeCastForPrompt({ children: [] })).toEqual([]);
  });

  it("enforces exactly one named child with no duplication", () => {
    const [line, ...rest] = describeCastForPrompt({
      children: [{ characterKey: "ivy", displayName: "Ivy" }],
    });
    expect(rest).toHaveLength(0);
    expect(line).toContain("exactly one child: Ivy");
    expect(line).toContain("Draw Ivy exactly once");
    expect(line).toContain("do not duplicate this child");
    expect(line).toContain("do not add any other or background children");
  });

  it("enforces an exact count and lists two children in readable English", () => {
    const [line] = describeCastForPrompt({
      children: [
        { characterKey: "ivy", displayName: "Ivy" },
        { characterKey: "max", displayName: "Max" },
      ],
    });
    expect(line).toContain("exactly 2 children: Ivy and Max");
    expect(line).toContain("Draw each child exactly once");
  });

  it("uses an Oxford-style list for three or more children", () => {
    const [line] = describeCastForPrompt({
      children: [
        { characterKey: "ivy", displayName: "Ivy" },
        { characterKey: "max", displayName: "Max" },
        { characterKey: "sam", displayName: "Sam" },
      ],
    });
    expect(line).toContain("exactly 3 children: Ivy, Max and Sam");
  });

  it("ignores blank names so the count matches the real cast", () => {
    expect(
      describeCastForPrompt({
        children: [
          { characterKey: "ivy", displayName: "Ivy" },
          { characterKey: "ghost", displayName: "   " },
        ],
      })[0],
    ).toContain("exactly one child: Ivy");
  });
});

describe("describeCompanionsForPrompt (ADR-008 part 3: pinned companion species)", () => {
  it("returns no directive for zero companions", () => {
    expect(describeCompanionsForPrompt([])).toEqual([]);
  });

  it("pins the species + appearance of a named companion and forbids swaps", () => {
    const [line, ...rest] = describeCompanionsForPrompt([
      {
        key: "pip-the-owl",
        species: "owl",
        appearance: "a fluffy grey owlet",
      },
    ]);
    expect(rest).toHaveLength(0);
    expect(line).toContain("Pip the owl");
    expect(line).toContain("who is an owl (a fluffy grey owlet)");
    expect(line).toContain("Draw Pip the owl as an owl");
    expect(line).toContain("never change Pip the owl's species");
    expect(line).toContain("swap Pip the owl for a different animal");
  });

  it("uses 'a' before a consonant-sound species", () => {
    const [line] = describeCompanionsForPrompt([
      { key: "nib", species: "cat", appearance: "black cat" },
    ]);
    expect(line).toContain("who is a cat");
    expect(line).toContain("Draw Nib as a cat");
  });

  it("emits one directive per companion and skips a companion missing a species", () => {
    const lines = describeCompanionsForPrompt([
      { key: "pip", species: "owl", appearance: "grey owlet" },
      { key: "nmeep", species: "   ", appearance: "small" },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Pip");
  });
});

describe("describeSettingForPrompt (ADR-008 part 4: setting + time-of-day)", () => {
  it("returns no directive for an absent setting (safe absence)", () => {
    expect(describeSettingForPrompt(undefined)).toEqual([]);
  });

  it("spells out a night scene so it is NOT rendered in daylight", () => {
    const [line, ...rest] = describeSettingForPrompt({
      location: "a cosy bedroom",
      timeOfDay: "night",
    });
    expect(rest).toHaveLength(0);
    expect(line).toContain("SETTING: a cosy bedroom");
    expect(line).toContain("at night");
    expect(line).toContain("must NOT look like daytime");
  });

  it("describes a daytime scene with daylight guidance", () => {
    expect(
      describeSettingForPrompt({ location: "a meadow", timeOfDay: "day" })[0],
    ).toContain("full daylight");
  });
});

describe("wardrobe states (ADR-008 part 2: per-scene wardrobe)", () => {
  const pyjamas: SceneWardrobe = {
    stateKey: "pyjamas",
    appearance: "star-print flannel pyjamas",
  };

  // The child's reference set as selected for a scene: identity + a second angle for
  // the prominent child, plus the everyday outfit-slot reference.
  const childRefs: SelectedReference[] = [
    {
      slot: "identity",
      assetId: "nell-front",
      characterKey: "nell",
      view: "front-portrait",
    },
    {
      slot: "second-angle",
      assetId: "nell-3q",
      characterKey: "nell",
      view: "three-quarter",
    },
    {
      slot: "outfit",
      assetId: "nell-outfit",
      characterKey: "nell",
      view: "default-outfit",
    },
  ];

  describe("isEverydayWardrobe", () => {
    it("treats absent and the reserved 'everyday' key as everyday", () => {
      expect(isEverydayWardrobe(undefined)).toBe(true);
      expect(isEverydayWardrobe(null)).toBe(true);
      expect(isEverydayWardrobe({ stateKey: "everyday" })).toBe(true);
    });

    it("treats a declared alternate state as NOT everyday", () => {
      expect(isEverydayWardrobe(pyjamas)).toBe(false);
    });
  });

  describe("describeWardrobeForPrompt", () => {
    it("emits NO directive for an everyday / absent wardrobe (safe absence)", () => {
      expect(describeWardrobeForPrompt(undefined)).toEqual([]);
      expect(describeWardrobeForPrompt(null)).toEqual([]);
      expect(describeWardrobeForPrompt({ stateKey: "everyday" })).toEqual([]);
    });

    it("pins the declared outfit AND keeps identity on the reference (alternate)", () => {
      const lines = describeWardrobeForPrompt(pyjamas);
      expect(lines).toHaveLength(2);
      expect(lines[0]).toContain("star-print flannel pyjamas");
      expect(lines[0]).toContain("NOT in the everyday reference outfit");
      // Non-everyday scenes MUST still instruct face/hair follow the identity ref.
      expect(lines[1]).toContain("face, hair, skin tone and features");
      expect(lines[1]).toContain("identity reference");
    });

    it("emits nothing when an alternate state has no appearance text", () => {
      expect(describeWardrobeForPrompt({ stateKey: "pyjamas" })).toEqual([]);
    });
  });

  describe("describeWardrobeForReview", () => {
    it("carries the declared wardrobe as an outfit note for an alternate state", () => {
      const [note, ...rest] = describeWardrobeForReview(pyjamas);
      expect(rest).toHaveLength(0);
      expect(note).toContain("star-print flannel pyjamas");
      expect(note).toContain("no outfit reference image");
    });

    it("emits NO note for everyday / absent (compare against the reference as today)", () => {
      expect(describeWardrobeForReview(undefined)).toEqual([]);
      expect(describeWardrobeForReview({ stateKey: "everyday" })).toEqual([]);
    });
  });

  describe("referencesForWardrobe (the outfit-reference attachment decision)", () => {
    it("omits the outfit reference but KEEPS identity + second-angle (alternate)", () => {
      const kept = referencesForWardrobe(childRefs, pyjamas);
      expect(kept.map((r) => r.slot)).toEqual(["identity", "second-angle"]);
      // Identity is never conditional (rule 7).
      expect(kept.some((r) => r.slot === "identity")).toBe(true);
      expect(kept.some((r) => r.slot === "outfit")).toBe(false);
    });

    it("keeps every reference unchanged for everyday / absent (byte-identical)", () => {
      expect(referencesForWardrobe(childRefs, undefined)).toEqual(childRefs);
      expect(
        referencesForWardrobe(childRefs, { stateKey: "everyday" }),
      ).toEqual(childRefs);
    });
  });

  describe("buildImageSceneRequest wardrobe carriage", () => {
    const base = {
      spec: { scene: "Nell on the porch", aspect: "landscape" as const },
      artBible: MVP_ART_BIBLE,
      placements: [{ characterKey: "nell", prominent: true }],
      references: childRefs,
      continuityNotes: [],
      seed: 7,
    };

    it("omits wardrobe when none is supplied (everyday default, safe absence)", () => {
      expect(buildImageSceneRequest(base).wardrobe).toBeUndefined();
    });

    it("carries the declared wardrobe with a trimmed appearance", () => {
      const r = buildImageSceneRequest({
        ...base,
        wardrobe: { stateKey: "pyjamas", appearance: "  cosy pyjamas  " },
      });
      expect(r.wardrobe).toEqual({
        stateKey: "pyjamas",
        appearance: "cosy pyjamas",
      });
    });
  });
});
