import { invalidCommandError } from "@/lib/errors";
import type { StoryDna } from "./story-dna";

/**
 * NORMALISED one-off plan + chapter-draft domain types and the DETERMINISTIC
 * draft checks the application runs before a draft may be reviewed
 * (`docs/03-ai/orchestration.md` "Deterministic validation";
 * `docs/02-storytelling/story-engine.md` publication gate step 2). These are
 * APP calculations over structured output, never model judgements: word-count
 * band, beat coverage, and illustration-anchor validity.
 *
 * Pure module. The plan/draft shapes are the post-normalisation domain artifacts
 * (semantic keys, not database ids); the persistence layer maps them to rows.
 */

export interface OneOffPlanBeat {
  key: string;
  description: string;
}

export interface OneOffPlan {
  title: string;
  setting: string;
  /** The protagonist, referenced by a Story DNA character key. */
  protagonistKey: string;
  protagonistDesire: string;
  obstacle: string;
  emotionalTheme: string;
  beats: OneOffPlanBeat[];
  climax: string;
  resolution: string;
  calmingClose: string;
}

export interface DraftAnchor {
  key: string;
  /** Insert the illustration AFTER this paragraph index (0 = before all prose). */
  afterParagraph: number;
  description: string;
}

export interface ChapterDraft {
  title: string;
  paragraphs: string[];
  /** Beat keys the writer asserts it covered (verified against the plan). */
  beatsCovered: string[];
  anchors: DraftAnchor[];
}

/** Maximum illustrations for a one-off (`one-off-stories.md` "three to five"). */
export const MAX_ILLUSTRATIONS = 5;

/** Count words across the draft's paragraphs (whitespace-delimited). */
export function countDraftWords(paragraphs: string[]): number {
  return paragraphs.reduce((total, p) => {
    const words = p.trim().split(/\s+/).filter(Boolean);
    return total + words.length;
  }, 0);
}

/**
 * The lenient acceptance band for the deterministic word-count check. The plan
 * TARGET communicated to the model is the tight ±20% Story DNA band; the CHECK
 * accepts a wider window so a naturally-paced draft is not regenerated for a few
 * words, while still catching a draft that is far too short or too long.
 */
export function wordCountAcceptable(count: number, dna: StoryDna): boolean {
  const floor = Math.round(dna.wordCountTarget.min * 0.6);
  const ceil = Math.round(dna.wordCountTarget.max * 1.5);
  return count >= floor && count <= ceil;
}

/**
 * Run the deterministic draft checks. Throws a safe INVALID_COMMAND (which the
 * pipeline classifies as a domain-invalid rejection → repair/regenerate) when:
 *  - the word count is outside the acceptable band;
 *  - the asserted beat coverage does not exactly match the plan's beat keys;
 *  - an illustration anchor points past the end of the prose, or there are more
 *    than the maximum illustrations.
 * Used as the pipeline's `domainValidate` for the draft stage.
 */
export function validateDraftAgainstPlan(
  draft: ChapterDraft,
  plan: OneOffPlan,
  dna: StoryDna,
): void {
  if (draft.paragraphs.length < 3) {
    throw invalidCommandError({
      internalDetail: `Draft has only ${draft.paragraphs.length} paragraphs; a bedtime story needs at least 3.`,
      stage: "draft.deterministic",
    });
  }

  const words = countDraftWords(draft.paragraphs);
  if (!wordCountAcceptable(words, dna)) {
    throw invalidCommandError({
      internalDetail: `Draft word count ${words} is outside the acceptable band for target ${dna.wordCountTarget.min}–${dna.wordCountTarget.max}.`,
      stage: "draft.deterministic",
    });
  }

  // Beat coverage: the asserted set must EQUAL the plan's beat keys.
  const planKeys = new Set(plan.beats.map((b) => b.key));
  const coveredKeys = new Set(draft.beatsCovered);
  if (coveredKeys.size !== planKeys.size) {
    throw invalidCommandError({
      internalDetail: `Draft asserts ${coveredKeys.size} covered beats; the plan has ${planKeys.size}.`,
      stage: "draft.deterministic",
    });
  }
  for (const key of planKeys) {
    if (!coveredKeys.has(key)) {
      throw invalidCommandError({
        internalDetail: `Draft does not cover plan beat "${key}".`,
        stage: "draft.deterministic",
      });
    }
  }

  // Anchor validity.
  if (draft.anchors.length > MAX_ILLUSTRATIONS) {
    throw invalidCommandError({
      internalDetail: `Draft has ${draft.anchors.length} illustration anchors; the maximum is ${MAX_ILLUSTRATIONS}.`,
      stage: "draft.deterministic",
    });
  }
  for (const anchor of draft.anchors) {
    if (
      anchor.afterParagraph < 0 ||
      anchor.afterParagraph > draft.paragraphs.length
    ) {
      throw invalidCommandError({
        internalDetail: `Illustration anchor "${anchor.key}" points after paragraph ${anchor.afterParagraph}, outside 0..${draft.paragraphs.length}.`,
        stage: "draft.deterministic",
      });
    }
  }
}
