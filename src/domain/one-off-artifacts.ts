import { invalidCommandError } from "@/lib/errors";
import {
  EVERYDAY_WARDROBE_KEY,
  type SceneCompanion,
  type SceneSetting,
  type SceneWardrobe,
} from "./image-request";
import type { StoryDna } from "./story-dna";
import type { ChapterDraft, DraftAnchor, OneOffPlan } from "./story-draft";

/**
 * NORMALISE + CROSS-REFERENCE the one-off structured artifacts
 * (`docs/03-ai/structured-output.md` validation pipeline: normalise →
 * cross-reference validate). Pure, structurally-typed against the wire shapes so
 * the domain never imports the application wire schemas. Unknown references are
 * REJECTED (throw → the pipeline repairs/regenerates).
 */

export interface OneOffPlanWireLike {
  schemaVersion: string;
  title: string;
  setting: string;
  protagonistKey: string;
  protagonistDesire: string;
  obstacle: string;
  emotionalTheme: string;
  beats: { key: string; description: string }[];
  climax: string;
  resolution: string;
  calmingClose: string;
}

export interface ChapterDraftWireLike {
  schemaVersion: string;
  title: string;
  paragraphs: string[];
  beatsCovered: string[];
  illustrationAnchors: {
    key: string;
    afterParagraph: number;
    description: string;
  }[];
}

export interface IllustrationPlanWireLike {
  schemaVersion: string;
  illustrations: {
    anchorKey: string;
    caption: string;
    sceneDescription: string;
    aspect: "portrait" | "landscape" | "square";
    /** ADR-008 part 3: declared recurring non-child companions (optional). */
    companions?: { key: string; species: string; appearance: string }[];
    /** ADR-008 part 4: declared setting + time-of-day (optional). */
    setting?: { location: string; timeOfDay: SceneSetting["timeOfDay"] };
    /** ADR-008 part 2: the wardrobe STATE-KEY this scene references (optional). */
    wardrobe?: string;
  }[];
  /** ADR-008 part 2: the story's wardrobe STATES, declared once (optional). */
  wardrobeStates?: { key: string; appearance: string }[];
}

export interface IllustrationSpec {
  anchorKey: string;
  caption: string;
  sceneDescription: string;
  aspect: "portrait" | "landscape" | "square";
  /**
   * Recurring non-child companions declared canonically for this scene (ADR-008
   * part 3). Empty/absent for a pre-ADR-008 spec or a scene with no companions.
   */
  companions?: SceneCompanion[];
  /** Canonical setting + time-of-day (ADR-008 part 4); absent ⇒ not carried. */
  setting?: SceneSetting;
  /**
   * The declared wardrobe state for this scene (ADR-008 part 2). Carried (with the
   * appearance denormalised from the story-level declaration) ONLY for a non-everyday
   * state; an everyday/absent scene omits it ⇒ safe absence (uses the everyday
   * outfit reference exactly as a pre-part-2 spec).
   */
  wardrobe?: SceneWardrobe;
}

// --- Plan ---------------------------------------------------------------

/** Reject duplicate beat keys or a protagonist that is not in the cast. */
export function crossReferenceOneOffPlan(
  wire: OneOffPlanWireLike,
  dna: StoryDna,
): void {
  const seen = new Set<string>();
  for (const b of wire.beats) {
    if (seen.has(b.key)) {
      throw invalidCommandError({
        internalDetail: `Duplicate plan beat key "${b.key}".`,
        stage: "plan.cross-reference",
      });
    }
    seen.add(b.key);
  }
  const castKeys = new Set(dna.characters.map((c) => c.key));
  if (!castKeys.has(wire.protagonistKey)) {
    throw invalidCommandError({
      internalDetail: `Plan protagonistKey "${wire.protagonistKey}" is not one of the cast keys.`,
      stage: "plan.cross-reference",
    });
  }
}

export function normaliseOneOffPlan(wire: OneOffPlanWireLike): OneOffPlan {
  return {
    title: wire.title.trim(),
    setting: wire.setting.trim(),
    protagonistKey: wire.protagonistKey,
    protagonistDesire: wire.protagonistDesire.trim(),
    obstacle: wire.obstacle.trim(),
    emotionalTheme: wire.emotionalTheme.trim(),
    beats: wire.beats.map((b) => ({
      key: b.key,
      description: b.description.trim(),
    })),
    climax: wire.climax.trim(),
    resolution: wire.resolution.trim(),
    calmingClose: wire.calmingClose.trim(),
  };
}

/** Domain-validate the plan: beat count within the Story DNA beat band. */
export function validateOneOffPlan(plan: OneOffPlan, dna: StoryDna): void {
  const n = plan.beats.length;
  if (n < dna.beatTarget.min || n > dna.beatTarget.max) {
    throw invalidCommandError({
      internalDetail: `Plan has ${n} beats; the target band is ${dna.beatTarget.min}–${dna.beatTarget.max}.`,
      stage: "plan.domain",
    });
  }
}

// --- Draft --------------------------------------------------------------

/** Reject duplicate covered-beat keys or duplicate anchor keys. */
export function crossReferenceChapterDraft(wire: ChapterDraftWireLike): void {
  const beatSeen = new Set<string>();
  for (const key of wire.beatsCovered) {
    if (beatSeen.has(key)) {
      throw invalidCommandError({
        internalDetail: `Duplicate covered-beat key "${key}".`,
        stage: "draft.cross-reference",
      });
    }
    beatSeen.add(key);
  }
  const anchorSeen = new Set<string>();
  for (const a of wire.illustrationAnchors) {
    if (anchorSeen.has(a.key)) {
      throw invalidCommandError({
        internalDetail: `Duplicate illustration-anchor key "${a.key}".`,
        stage: "draft.cross-reference",
      });
    }
    anchorSeen.add(a.key);
  }
}

export function normaliseChapterDraft(
  wire: ChapterDraftWireLike,
): ChapterDraft {
  const anchors: DraftAnchor[] = wire.illustrationAnchors.map((a) => ({
    key: a.key,
    afterParagraph: a.afterParagraph,
    description: a.description.trim(),
  }));
  return {
    title: wire.title.trim(),
    paragraphs: wire.paragraphs
      .map((p) => p.trim())
      .filter((p) => p.length > 0),
    beatsCovered: [...wire.beatsCovered],
    anchors,
  };
}

// --- Illustration plan --------------------------------------------------

/** Reject an illustration that references an unknown draft anchor, or duplicates. */
export function crossReferenceIllustrationPlan(
  wire: IllustrationPlanWireLike,
  anchorKeys: readonly string[],
): void {
  const known = new Set(anchorKeys);
  const seen = new Set<string>();

  // ADR-008 part 2: validate the story-level wardrobe STATES first, then check each
  // scene's wardrobe reference against them. `everyday` is reserved/implicit — the
  // model may not redeclare it — and every declared key must be unique.
  const declaredWardrobe = new Set<string>();
  for (const state of wire.wardrobeStates ?? []) {
    if (state.key === EVERYDAY_WARDROBE_KEY) {
      throw invalidCommandError({
        internalDetail: `Wardrobe state "${EVERYDAY_WARDROBE_KEY}" is reserved and must not be declared.`,
        stage: "illustration.cross-reference",
      });
    }
    if (declaredWardrobe.has(state.key)) {
      throw invalidCommandError({
        internalDetail: `Duplicate wardrobe state key "${state.key}".`,
        stage: "illustration.cross-reference",
      });
    }
    declaredWardrobe.add(state.key);
  }

  for (const spec of wire.illustrations) {
    if (!known.has(spec.anchorKey)) {
      throw invalidCommandError({
        internalDetail: `Illustration references unknown anchor key "${spec.anchorKey}".`,
        stage: "illustration.cross-reference",
      });
    }
    if (seen.has(spec.anchorKey)) {
      throw invalidCommandError({
        internalDetail: `Duplicate illustration for anchor key "${spec.anchorKey}".`,
        stage: "illustration.cross-reference",
      });
    }
    seen.add(spec.anchorKey);

    // ADR-008 part 3: a companion key must be unique WITHIN a scene (two distinct
    // descriptors for the same key would make the enforced species ambiguous).
    const companionKeys = new Set<string>();
    for (const companion of spec.companions ?? []) {
      if (companionKeys.has(companion.key)) {
        throw invalidCommandError({
          internalDetail: `Duplicate companion key "${companion.key}" in illustration "${spec.anchorKey}".`,
          stage: "illustration.cross-reference",
        });
      }
      companionKeys.add(companion.key);
    }

    // ADR-008 part 2: a scene may only reference the reserved `everyday` key or a
    // wardrobe state DECLARED at story level (an alternate outfit must be a state the
    // story defined — keeping the original unmotivated outfit-drift bug dead).
    if (
      spec.wardrobe &&
      spec.wardrobe !== EVERYDAY_WARDROBE_KEY &&
      !declaredWardrobe.has(spec.wardrobe)
    ) {
      throw invalidCommandError({
        internalDetail: `Illustration "${spec.anchorKey}" references undeclared wardrobe state "${spec.wardrobe}".`,
        stage: "illustration.cross-reference",
      });
    }
  }
}

export function normaliseIllustrationPlan(
  wire: IllustrationPlanWireLike,
): IllustrationSpec[] {
  // ADR-008 part 2: resolve each scene's wardrobe state-KEY against the single
  // story-level declaration, DENORMALISING the appearance onto every scene that
  // shares the state — so five pyjama scenes carry identical pyjamas text (copied
  // from one declaration). An everyday/absent reference resolves to no wardrobe
  // (safe absence: the everyday outfit reference is the authority).
  const appearanceByState = new Map(
    (wire.wardrobeStates ?? []).map((state) => [
      state.key,
      state.appearance.trim(),
    ]),
  );
  const resolveWardrobe = (key?: string): SceneWardrobe | undefined => {
    if (!key || key === EVERYDAY_WARDROBE_KEY) return undefined;
    const appearance = appearanceByState.get(key);
    return { stateKey: key, ...(appearance ? { appearance } : {}) };
  };

  return wire.illustrations.map((s) => {
    const companions = (s.companions ?? []).map((c) => ({
      key: c.key,
      species: c.species.trim(),
      appearance: c.appearance.trim(),
    }));
    const wardrobe = resolveWardrobe(s.wardrobe);
    return {
      anchorKey: s.anchorKey,
      caption: s.caption.trim(),
      sceneDescription: s.sceneDescription.trim(),
      aspect: s.aspect,
      // Preserve safe absence: omit the fields entirely when nothing was declared,
      // so a spec round-trips identically to a pre-ADR-008 one.
      ...(companions.length > 0 ? { companions } : {}),
      ...(s.setting
        ? {
            setting: {
              location: s.setting.location.trim(),
              timeOfDay: s.setting.timeOfDay,
            },
          }
        : {}),
      ...(wardrobe ? { wardrobe } : {}),
    };
  });
}
