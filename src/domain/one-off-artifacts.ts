import { invalidCommandError } from "@/lib/errors";
import type { SceneCompanion, SceneSetting } from "./image-request";
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
  }[];
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
  }
}

export function normaliseIllustrationPlan(
  wire: IllustrationPlanWireLike,
): IllustrationSpec[] {
  return wire.illustrations.map((s) => {
    const companions = (s.companions ?? []).map((c) => ({
      key: c.key,
      species: c.species.trim(),
      appearance: c.appearance.trim(),
    }));
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
    };
  });
}
