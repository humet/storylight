import { describe, expect, it } from "vitest";

import type { ImageGenerationSpec } from "@/application/ports/image-model";
import { MVP_ART_BIBLE } from "@/domain/art-bible";
import type { CharacterVisualDescriptor } from "@/domain/character-visual-descriptor";
import { buildInstruction } from "./gateway-image-model";

/**
 * Pure prompt-ASSEMBLY tests for the character-reference adapter (no paid calls,
 * no gateway). These pin the appearance-notes contract: parent-authored notes
 * steer the DESCRIPTOR-ONLY (anchor) render verbatim, and are deliberately ABSENT
 * once the coherent set is conditioned on the anchor image — where the anchor
 * bytes, not prose, are the identity/outfit source of truth (ADR-003, rule 6).
 */

function descriptor(
  overrides: Partial<CharacterVisualDescriptor> = {},
): CharacterVisualDescriptor {
  return {
    characterKey: "rosa-abc",
    displayName: "Rosa",
    apparentAge: 7,
    pronouns: ["she", "her"],
    motifs: [],
    appearanceNotes: null,
    ...overrides,
  };
}

function spec(
  overrides: Partial<ImageGenerationSpec> = {},
): ImageGenerationSpec {
  return {
    view: "default-outfit",
    descriptor: descriptor(),
    artBibleVersion: MVP_ART_BIBLE.version,
    seed: 4242,
    ...overrides,
  };
}

const APPEARANCE_PREFIX =
  "APPEARANCE (parent's description — follow it faithfully):";

describe("buildInstruction — appearance notes on the anchor render", () => {
  it("includes the parent's description verbatim on the descriptor-only render", () => {
    const notes = "Curly red hair, round glasses, always in a yellow raincoat";
    const text = buildInstruction(
      spec({ descriptor: descriptor({ appearanceNotes: notes }) }),
    );
    expect(text).toContain(`${APPEARANCE_PREFIX} ${notes}.`);
  });

  it("omits the APPEARANCE line when there are no notes", () => {
    const text = buildInstruction(
      spec({ descriptor: descriptor({ appearanceNotes: null }) }),
    );
    expect(text).not.toContain(APPEARANCE_PREFIX);
  });

  it("does NOT re-inject notes once the render is conditioned on the anchor image", () => {
    const notes = "Curly red hair, round glasses, always in a yellow raincoat";
    const text = buildInstruction(
      spec({
        view: "side-view",
        descriptor: descriptor({ appearanceNotes: notes }),
        anchorImage: {
          bytes: new Uint8Array([1, 2, 3]),
          contentType: "image/png",
        },
      }),
    );
    expect(text).not.toContain(APPEARANCE_PREFIX);
    expect(text).not.toContain(notes);
  });
});
