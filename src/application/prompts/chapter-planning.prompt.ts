import { buildRequestEnvelope, GLOBAL_POLICY } from "./global-policy";
import type { PromptAsset } from "./prompt-asset";

/**
 * CHAPTER PLANNING prompt (`docs/03-ai/orchestration.md` "Create chapter plan";
 * `docs/02-storytelling/story-series.md` chapter shape). Turns the pinned bible's
 * blueprint for THIS chapter plus the latest continuity recap into a concrete
 * plan for one nightly chapter — before any prose. The blueprint, world rules,
 * cast keys, continuity recap, and constraints are trusted canonical context;
 * there is no untrusted input at this stage.
 */

export interface ChapterPlanningCtx {
  chapterNumber: number;
  readingAge: string;
  tone: string;
  beatTarget: { min: number; max: number };
  worldRules: string[];
  characters: { key: string; name: string; apparentAge: number }[];
  blueprint: {
    narrativePurpose: string;
    openingState: string;
    localGoal: string;
    conflict: string;
    majorBeats: { key: string; description: string }[];
    emotionalMovement: string;
    closingState: string;
    tomorrowPromise: string;
  };
  continuityRecap: unknown;
  prohibitedOutcomes: string[];
}

const AUTHORITY = [
  "STAGE: Next-chapter planning for an ongoing series.",
  "You MAY: choose the chapter title, setting, the protagonist's local desire and",
  "  obstacle, an emotional theme, ordered beats, a climax, a local resolution, and",
  "  a calming close that carries the blueprint's tomorrow promise.",
  "You MAY NOT: write prose, contradict the bible or the continuity recap, change",
  "  the planned blueprint, or resolve a thread the blueprint does not resolve.",
  "CANONICAL: the blueprint, world rules, cast keys, continuity recap, beat band,",
  "  and prohibited outcomes in <canonical_context> are fixed and true right now.",
  "Return ONLY the structured chapter plan described in <task>.",
].join("\n");

const TASK = [
  "Produce a single JSON chapter-plan object with:",
  '- schemaVersion: the exact string "chapter-plan.v1";',
  "- title, setting, protagonistDesire, obstacle, emotionalTheme;",
  "- protagonistKey: one of the canonical cast keys;",
  "- beats: ordered, within the canonical beat band, each a local kebab-case key",
  "  and a short description, realising the blueprint's major beats;",
  "- climax, resolution, calmingClose. The chapter must reach a LOCAL emotional",
  "  resolution and close with the blueprint's gentle tomorrow promise, never a",
  "  maximum-danger cliffhanger.",
].join("\n");

export const chapterPlanningPrompt: PromptAsset<ChapterPlanningCtx, never> = {
  purpose: "chapter-planning",
  version: "1.0.0",
  capability: "chapter-planning",
  build({ canonicalContext }) {
    const system = [GLOBAL_POLICY, "", AUTHORITY].join("\n");
    const prompt = buildRequestEnvelope({
      authority: AUTHORITY,
      canonicalContext,
      untrustedInput: {},
      task: TASK,
      qualityChecks: [
        "protagonistKey matches a canonical cast key.",
        "Beat keys are unique; the beat count is within the canonical band.",
        "The chapter reaches a local resolution and a gentle tomorrow close.",
        "Nothing contradicts the continuity recap or the bible.",
        "No database ids appear; only local kebab-case keys.",
      ],
    });
    return { system, prompt };
  },
};
