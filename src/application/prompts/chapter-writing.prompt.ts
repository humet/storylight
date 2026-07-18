import { buildRequestEnvelope, GLOBAL_POLICY } from "./global-policy";
import type { PromptAsset } from "./prompt-asset";

/**
 * SERIES CHAPTER WRITING prompt (`docs/02-storytelling/story-series.md` chapter
 * shape; `docs/company/writing-style.md`). Turns the canonical chapter plan into
 * bedtime prose for one night. Includes a brief reorientation from the continuity
 * recap without repetitive recap, and closes with gentle anticipation. The plan,
 * recap, and constraints are canonical; there is no untrusted input at this stage.
 */

export interface ChapterWritingCtx {
  readingAge: string;
  wordCountTarget: { min: number; max: number };
  plan: {
    title: string;
    setting: string;
    emotionalTheme: string;
    protagonistKey: string;
    beats: { key: string; description: string }[];
    climax: string;
    resolution: string;
    calmingClose: string;
  };
  characters: { key: string; name: string; apparentAge: number }[];
  continuityRecap: unknown;
  prohibitedOutcomes: string[];
  isFirstChapter: boolean;
}

const AUTHORITY = [
  "STAGE: Writing one nightly chapter of an ongoing series.",
  "You MAY: write the prose paragraphs that realise the canonical plan, opening",
  "  with a brief, natural reorientation (no repetitive recap) and closing warmly.",
  "You MAY NOT: change the plan, contradict the continuity recap or the bible, add",
  "  a new central problem, exceed the illustration limit, or produce a prohibited",
  "  outcome.",
  "CANONICAL: the plan, reading age, word-count target, cast, continuity recap, and",
  "  prohibited outcomes in <canonical_context> are fixed and true right now.",
  "Return ONLY the structured draft described in <task>.",
].join("\n");

const TASK = [
  "Produce a single JSON draft object with:",
  '- schemaVersion: the exact string "chapter-draft.v1";',
  "- title;",
  "- paragraphs: ordered prose that reads naturally aloud, near the canonical",
  "  word-count target, consistent with the continuity recap, closing calmly with",
  "  gentle anticipation for tomorrow;",
  "- beatsCovered: the plan beat keys this draft realises (cover every plan beat);",
  "- illustrationAnchors: up to five, each a local kebab-case key, an",
  "  afterParagraph index (0 = before all prose), and a short scene description.",
].join("\n");

export const chapterWritingPrompt: PromptAsset<ChapterWritingCtx, never> = {
  purpose: "chapter-writing",
  version: "1.0.0",
  capability: "chapter-writing",
  build({ canonicalContext }) {
    const system = [GLOBAL_POLICY, "", AUTHORITY].join("\n");
    const prompt = buildRequestEnvelope({
      authority: AUTHORITY,
      canonicalContext,
      untrustedInput: {},
      task: TASK,
      qualityChecks: [
        "Every plan beat key appears in beatsCovered.",
        "The prose stays near the canonical word-count target.",
        "Nothing contradicts the continuity recap.",
        "The close is gentle with tomorrow anticipation; no prohibited outcome appears.",
        "No database ids appear; only local kebab-case keys.",
      ],
    });
    return { system, prompt };
  },
};
