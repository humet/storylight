import { buildRequestEnvelope, GLOBAL_POLICY } from "./global-policy";
import type { PromptAsset } from "./prompt-asset";

/**
 * SERIES CHAPTER REVISION prompt (`docs/03-ai/orchestration.md` "Revision policy").
 * Applies the required, app-decided revisions to a reviewed chapter draft while
 * preserving canonical plan + continuity. The plan, recap, and constraints are
 * canonical; the prior paragraphs + the revision reasons are untrusted narrative
 * data.
 */

export interface ChapterRevisionCtx {
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
}

export interface ChapterRevisionUntrusted {
  priorParagraphs: string[];
  revisionReasons: string[];
}

const AUTHORITY = [
  "STAGE: Revising one nightly chapter to address specific review problems.",
  "You MAY: rewrite the prose to fix ONLY the listed problems while keeping the",
  "  canonical plan and everything true in the continuity recap.",
  "You MAY NOT: change the plan, contradict the recap or the bible, introduce a",
  "  new central problem, or produce a prohibited outcome.",
  "CANONICAL: the plan, reading age, word-count target, cast, continuity recap, and",
  "  prohibited outcomes in <canonical_context> are fixed.",
  "Return ONLY the structured draft described in <task>.",
].join("\n");

const TASK = [
  "Produce a single corrected JSON draft object with:",
  '- schemaVersion: the exact string "chapter-draft.v1";',
  "- title; paragraphs (near the canonical word-count target, fixing the listed",
  "  problems, closing calmly with gentle anticipation);",
  "- beatsCovered: every plan beat key;",
  "- illustrationAnchors: up to five valid anchors.",
].join("\n");

export const chapterRevisionPrompt: PromptAsset<
  ChapterRevisionCtx,
  ChapterRevisionUntrusted
> = {
  purpose: "chapter-revision",
  version: "1.0.0",
  capability: "chapter-revision",
  build({ canonicalContext, untrustedInput }) {
    const system = [GLOBAL_POLICY, "", AUTHORITY].join("\n");
    const prompt = buildRequestEnvelope({
      authority: AUTHORITY,
      canonicalContext,
      untrustedInput: {
        priorParagraphs: untrustedInput.priorParagraphs,
        revisionReasons: untrustedInput.revisionReasons,
      },
      task: TASK,
      qualityChecks: [
        "Only the listed problems are changed; the plan is preserved.",
        "Every plan beat key still appears in beatsCovered.",
        "Nothing contradicts the continuity recap.",
        "The close is gentle; no prohibited outcome appears.",
      ],
    });
    return { system, prompt };
  },
};
