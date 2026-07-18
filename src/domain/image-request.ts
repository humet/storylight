import type { ArtBible } from "./art-bible";
import type { SelectedReference } from "./reference-selection";

/**
 * The MODEL-NEUTRAL image request (`docs/03-ai/image-generation.md` "Illustration
 * plan"; ADR-003). APPLICATION CODE builds this deterministically from the
 * validated `IllustrationSpec` + the pinned Art Bible + the selected references +
 * continuity notes; the image ADAPTER turns it into a concrete provider prompt.
 * It is DELIBERATELY not a prompt string — prompt construction stays on the
 * adapter side of the boundary (rule 12), and the model never chooses references.
 *
 * The builder is a pure function so a given spec always yields the same request
 * (snapshot-tested), which also makes the deterministic FAKE adapter reproducible.
 */

export type IllustrationAspect = "portrait" | "landscape" | "square";

/** Where the illustration sits — a chapter scene (4:3) or a cover (2:3). */
export type IllustrationKind = "chapter" | "cover";

export interface ImageDimensions {
  width: number;
  height: number;
}

/**
 * Resolve pixel dimensions at the routine 2K resolution
 * (`docs/03-ai/image-generation.md` "Mobile": chapter 4:3, cover 2:3, 2K). 2K is
 * ~2048 on the long edge; the short edge follows the aspect. Pure + deterministic.
 */
export function resolveDimensions(
  aspect: IllustrationAspect,
  kind: IllustrationKind = "chapter",
): ImageDimensions {
  const LONG = 2048;
  // A cover is always the 2:3 portrait framing regardless of the spec aspect.
  if (kind === "cover") {
    return { width: Math.round((LONG * 2) / 3), height: LONG };
  }
  switch (aspect) {
    case "portrait":
      // 3:4 portrait.
      return { width: Math.round((LONG * 3) / 4), height: LONG };
    case "square":
      return { width: LONG, height: LONG };
    case "landscape":
    default:
      // 4:3 landscape (the mobile chapter default).
      return { width: LONG, height: Math.round((LONG * 3) / 4) };
  }
}

/** A character placed in the scene (identity comes from the attached references). */
export interface ScenePlacement {
  characterKey: string;
  prominent: boolean;
}

export interface ImageSceneRequest {
  artBibleVersion: string;
  /** Style directives lifted verbatim from the Art Bible (medium + qualities). */
  styleDirectives: string[];
  /** Hard prohibitions the adapter must forbid in the prompt. */
  prohibitions: string[];
  aspect: IllustrationAspect;
  dimensions: ImageDimensions;
  /** The scene to depict (from the validated spec — never raw model text). */
  scene: string;
  placements: ScenePlacement[];
  /** Selected approved reference assets, in priority order (never model-chosen). */
  references: SelectedReference[];
  /** Continuity notes (outfits, props, locations) the render must respect. */
  continuityNotes: string[];
  /** Deterministic seed so a phase reproduces exactly on a resume. */
  seed: number;
  /**
   * Present ONLY for a targeted repair: an instruction that PRESERVES valid
   * composition and corrects specific failures (`image-generation.md` "Targeted
   * repair"). Absent on the initial attempt.
   */
  repairInstruction?: string;
}

export interface BuildImageSceneRequestInput {
  spec: {
    scene: string;
    aspect: IllustrationAspect;
  };
  artBible: ArtBible;
  placements: ScenePlacement[];
  references: SelectedReference[];
  continuityNotes: string[];
  seed: number;
  kind?: IllustrationKind;
  repairInstruction?: string;
}

/**
 * Build the model-neutral image request from the validated inputs. Pure and
 * deterministic (ADR-003): the model never appears here — every field is derived
 * from application-owned canonical data (the spec, the pinned Art Bible, the
 * application-selected references, the continuity notes).
 */
export function buildImageSceneRequest(
  input: BuildImageSceneRequestInput,
): ImageSceneRequest {
  const { spec, artBible } = input;
  return {
    artBibleVersion: artBible.version,
    styleDirectives: [artBible.medium, ...artBible.qualities],
    prohibitions: [...artBible.prohibitions],
    aspect: spec.aspect,
    dimensions: resolveDimensions(spec.aspect, input.kind ?? "chapter"),
    scene: spec.scene.trim(),
    placements: input.placements.map((p) => ({
      characterKey: p.characterKey,
      prominent: p.prominent,
    })),
    references: input.references.map((r) => ({ ...r })),
    continuityNotes: input.continuityNotes.map((n) => n.trim()).filter(Boolean),
    seed: input.seed,
    ...(input.repairInstruction
      ? { repairInstruction: input.repairInstruction.trim() }
      : {}),
  };
}
