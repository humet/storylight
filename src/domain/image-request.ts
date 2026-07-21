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

/**
 * One canonical child that MUST appear in the scene (ADR-008 part 1). Carries the
 * human `displayName` so the prompt can name the child ("exactly one child named
 * Ivy") — tying the count constraint to the attached identity reference. It
 * deliberately carries NO appearance/outfit text: a child's appearance is defined
 * by the approved reference IMAGE, not by any prose field (the profile only holds
 * interest-motifs, which are not appearance), so describing it here would invent
 * canonical data (AGENTS.md "do not invent a third design"; rule 6).
 */
export interface CastMember {
  characterKey: string;
  displayName: string;
}

/** The canonical cast the illustration must depict (children only for MVP). */
export interface SceneCast {
  children: CastMember[];
}

/** Closed vocabulary for a scene's time of day (ADR-008 part 4). */
export const TIMES_OF_DAY = ["day", "dawn", "dusk", "night"] as const;

export type TimeOfDay = (typeof TIMES_OF_DAY)[number];

/**
 * A recurring NON-child character — a companion, pet, or creature (ADR-008 part 3,
 * DESCRIPTOR level). Unlike a child, a companion has NO approved reference image
 * yet, so its canonical form is a DESCRIPTOR: a semantic `key` (its stable
 * identity, e.g. "pip"), its `species` (the blocking visual fact — "owl", never a
 * squirrel), and a short `appearance` note. Image-anchor conditioning (reusing a
 * first-approved page as a companion reference, ADR-008's deferred follow-up) is
 * NOT built here — the descriptor is prose only, which is precisely why the
 * species is enforced in the prompt AND the vision review instead of an image.
 */
export interface SceneCompanion {
  key: string;
  species: string;
  appearance: string;
}

/**
 * The canonical SETTING a scene must depict (ADR-008 part 4): a short `location`
 * plus a closed-enum `timeOfDay`, so a bedtime story stays night rather than
 * rendering a daytime page. Carried per illustration spec (a one-off's story-level
 * constant / a series scene's declared moment), never re-decided by the model.
 */
export interface SceneSetting {
  location: string;
  timeOfDay: TimeOfDay;
}

/**
 * The RESERVED wardrobe state key (ADR-008 part 2): the child's approved everyday
 * reference outfit. It is implicit — the planning model never declares or describes
 * it, and a scene that references it (or references nothing) is dressed from the
 * approved outfit REFERENCE, exactly as before part 2.
 */
export const EVERYDAY_WARDROBE_KEY = "everyday";

/**
 * The declared WARDROBE STATE a scene depicts the child in (ADR-008 part 2). The
 * child's wardrobe is PER-SCENE story data, not a single fixed constant: a story may
 * legitimately dress the child differently (pyjamas for a night porch, a raincoat, a
 * swimsuit) when the PROSE motivates it. Wardrobe states are declared ONCE at story
 * level (like companions) and each scene references one by key, defaulting to
 * `everyday`. The `appearance` is DENORMALISED onto every scene that shares a state
 * (copied from the single story-level declaration), so five pyjama scenes carry
 * identical pyjamas text. `everyday` (or an absent wardrobe) carries no appearance —
 * the approved outfit reference is the authority there (safe absence = pre-part-2).
 */
export interface SceneWardrobe {
  /** The declared state key. `everyday` is reserved (the approved reference outfit). */
  stateKey: string;
  /** The declared outfit for a non-everyday state; absent for `everyday`. */
  appearance?: string;
}

/**
 * True when the wardrobe is the reserved everyday outfit (or absent) — the ONLY case
 * where the approved outfit-slot reference is attached and judged as before part 2.
 * A non-everyday state instead gets a deterministic prompt directive + a review note.
 * Pure; the single predicate behind both the prompt directive and the
 * outfit-reference attachment decision.
 */
export function isEverydayWardrobe(wardrobe?: SceneWardrobe | null): boolean {
  return !wardrobe || wardrobe.stateKey === EVERYDAY_WARDROBE_KEY;
}

/** Join names as a readable English list ("Ivy", "Ivy and Max", "Ivy, Max and Sam"). */
function formatNameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * The explicit CAST directive lines (ADR-008 part 1), derived purely from the
 * canonical cast. Names each required child and states the exact child count with
 * an explicit no-duplication / no-extra-children instruction — the lever the
 * controlled probe showed removes the "two identical children" duplication that a
 * reference image alone does not prevent. Prompt STRING assembly stays adapter-side
 * (rule 12); this returns model-neutral directive lines, like `styleDirectives` /
 * `prohibitions` / `continuityNotes`. Empty when there is no cast.
 */
export function describeCastForPrompt(cast: SceneCast): string[] {
  const names = cast.children.map((c) => c.displayName.trim()).filter(Boolean);
  if (names.length === 0) return [];
  const list = formatNameList(names);
  if (names.length === 1) {
    return [
      `This illustration contains exactly one child: ${list}. Draw ${names[0]} exactly once — do not duplicate this child and do not add any other or background children.`,
    ];
  }
  return [
    `This illustration contains exactly ${names.length} children: ${list}. Draw each child exactly once — do not duplicate any child and do not add any other or background children.`,
  ];
}

/** Human-readable label for a semantic companion key ("pip-the-owl" → "Pip the owl"). */
function labelForKey(key: string): string {
  const cleaned = key.replace(/-/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * Pick "a"/"an" by the first letter's sound (simple vowel-letter heuristic — good
 * enough for the common species; edge cases like "hour"/"unicorn" are acceptable to
 * get slightly wrong for a prompt directive).
 */
function indefiniteArticle(word: string): string {
  return /^[aeiou]/i.test(word.trim()) ? "an" : "a";
}

/**
 * The explicit COMPANION directive lines (ADR-008 part 3), derived purely from the
 * canonical companion descriptors. Each names the recurring non-child character and
 * PINS its species + appearance — the lever that stops a companion (e.g. "Pip the
 * owl") being redrawn as a different animal from prose alone. A companion missing a
 * key or species is skipped (nothing to enforce). Model-neutral directive lines,
 * like `describeCastForPrompt`; the adapter assembles the prompt string (rule 12).
 * Empty when there are no companions (n=0 companions ⇒ no directive).
 */
export function describeCompanionsForPrompt(
  companions: SceneCompanion[],
): string[] {
  return companions
    .map((c) => ({
      key: c.key.trim(),
      species: c.species.trim(),
      appearance: c.appearance.trim(),
    }))
    .filter((c) => c.key && c.species)
    .map((c) => {
      const label = labelForKey(c.key);
      const appearance = c.appearance ? ` (${c.appearance})` : "";
      const article = indefiniteArticle(c.species);
      return `The scene includes a recurring companion, ${label}, who is ${article} ${c.species}${appearance}. Draw ${label} as ${article} ${c.species} with exactly this appearance — never change ${label}'s species or swap ${label} for a different animal or creature.`;
    });
}

const TIME_OF_DAY_GUIDANCE: Record<TimeOfDay, string> = {
  day: "in full daylight under a bright daytime sky",
  dawn: "at dawn, with soft early-morning light and a pale sky",
  dusk: "at dusk, with warm fading light and a deepening sky",
  night:
    "at night, under a dark night sky (moon and/or stars) with warm lantern or interior light — it must NOT look like daytime",
};

/**
 * The explicit SETTING directive line (ADR-008 part 4), derived purely from the
 * canonical setting. Spells out the location AND the required time-of-day lighting
 * so a night scene is not rendered in daylight. Model-neutral; empty when no
 * setting is carried (absent-setting ⇒ no directive, so a pre-ADR-008 spec is a
 * no-op).
 */
export function describeSettingForPrompt(setting?: SceneSetting): string[] {
  if (!setting) return [];
  const location = setting.location.trim();
  const time = TIME_OF_DAY_GUIDANCE[setting.timeOfDay];
  return [location ? `SETTING: ${location}, ${time}.` : `SETTING: ${time}.`];
}

/**
 * The explicit WARDROBE directive lines for GENERATION (ADR-008 part 2), derived
 * purely from the declared state. An everyday/absent wardrobe emits NOTHING (the
 * approved outfit reference is attached instead — byte-identical to pre-part-2); a
 * non-everyday state pins the declared outfit AND reiterates that face/hair/features
 * still follow the identity reference (rule 7 — identity is never conditional on the
 * outfit). Model-neutral; the adapter assembles the prompt string (rule 12).
 */
export function describeWardrobeForPrompt(
  wardrobe?: SceneWardrobe | null,
): string[] {
  if (isEverydayWardrobe(wardrobe)) return [];
  const appearance = (wardrobe?.appearance ?? "").trim();
  if (!appearance) return [];
  return [
    `WARDROBE: in this scene the child is dressed for the story's moment, NOT in the everyday reference outfit — the child is wearing ${appearance}. Draw exactly this clothing.`,
    "Change ONLY the clothing: the child's face, hair, skin tone and features MUST still match the attached identity reference exactly (never alter the child's likeness).",
  ];
}

/**
 * The WARDROBE continuity note fed to the vision REVIEW (ADR-008 part 2). Feeds the
 * existing `outfitNotes` mechanism (the review's `outfitConsistent` verdict), so no
 * parallel verdict is added. Everyday/absent ⇒ NO note ⇒ the reviewer compares the
 * outfit against the ATTACHED everyday outfit reference exactly as today; a
 * non-everyday state ⇒ a note describing the declared outfit to compare against
 * (there is no outfit reference image attached for such a scene). Pure.
 */
export function describeWardrobeForReview(
  wardrobe?: SceneWardrobe | null,
): string[] {
  if (isEverydayWardrobe(wardrobe)) return [];
  const appearance = (wardrobe?.appearance ?? "").trim();
  if (!appearance) return [];
  return [
    `the child is wearing ${appearance} for this scene (a story-motivated outfit; there is no outfit reference image — judge the clothing against this description)`,
  ];
}

/**
 * The reference selections whose BYTES to attach for a scene, given its wardrobe
 * (ADR-008 part 2). The identity + second-angle references are ALWAYS kept (rule 7 —
 * identity is never conditional); the everyday outfit-slot reference is attached
 * ONLY for an everyday (or absent) wardrobe. A non-everyday scene omits the outfit
 * reference and relies on the deterministic {@link describeWardrobeForPrompt}
 * directive instead, so the everyday outfit does not fight a story-motivated change.
 * Pure — the attach/omit decision lives in ONE place, reused by the workflow.
 */
export function referencesForWardrobe(
  references: SelectedReference[],
  wardrobe?: SceneWardrobe | null,
): SelectedReference[] {
  if (isEverydayWardrobe(wardrobe)) return references;
  return references.filter((r) => r.slot !== "outfit");
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
  /** Canonical cast that must appear (names + exact-count enforcement, ADR-008). */
  cast: SceneCast;
  /** Recurring non-child companions with a pinned species (ADR-008 part 3). */
  companions: SceneCompanion[];
  /** Canonical setting + time-of-day the render must honour (ADR-008 part 4). */
  setting?: SceneSetting;
  /**
   * The declared wardrobe state for this scene (ADR-008 part 2). Absent / everyday ⇒
   * no directive and the everyday outfit reference is attached; a non-everyday state
   * ⇒ a deterministic wardrobe directive and the outfit reference is omitted.
   */
  wardrobe?: SceneWardrobe;
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
  /** Canonical cast (optional; defaults to empty — no cast directive emitted). */
  cast?: SceneCast;
  /** Recurring companions (optional; defaults to empty — no companion directive). */
  companions?: SceneCompanion[];
  /** Canonical setting (optional; absent ⇒ no setting directive, review skips it). */
  setting?: SceneSetting;
  /** Declared wardrobe state (optional; absent/everyday ⇒ no directive, ADR-008 part 2). */
  wardrobe?: SceneWardrobe;
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
    cast: {
      children: (input.cast?.children ?? []).map((c) => ({
        characterKey: c.characterKey,
        displayName: c.displayName.trim(),
      })),
    },
    companions: (input.companions ?? []).map((c) => ({
      key: c.key.trim(),
      species: c.species.trim(),
      appearance: c.appearance.trim(),
    })),
    ...(input.setting
      ? {
          setting: {
            location: input.setting.location.trim(),
            timeOfDay: input.setting.timeOfDay,
          },
        }
      : {}),
    ...(input.wardrobe
      ? {
          wardrobe: {
            stateKey: input.wardrobe.stateKey.trim(),
            ...(input.wardrobe.appearance
              ? { appearance: input.wardrobe.appearance.trim() }
              : {}),
          },
        }
      : {}),
    references: input.references.map((r) => ({ ...r })),
    continuityNotes: input.continuityNotes.map((n) => n.trim()).filter(Boolean),
    seed: input.seed,
    ...(input.repairInstruction
      ? { repairInstruction: input.repairInstruction.trim() }
      : {}),
  };
}
