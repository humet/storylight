import { buildRequestEnvelope, GLOBAL_POLICY } from "./global-policy";
import type { PromptAsset } from "./prompt-asset";

/**
 * ONE-OFF WRITING prompt (`docs/02-storytelling/story-engine.md` draft stage;
 * `docs/company/writing-style.md` "Story prose"). Turns the canonical plan into
 * bedtime prose. The plan + constraints are trusted canonical context; the
 * parent's original idea is untrusted narrative data. The writer must assert its
 * beat coverage and mark up to five illustration anchors — both verified by
 * deterministic app checks, never trusted.
 */

export interface OneOffWritingCtx {
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
  prohibitedOutcomes: string[];
}

export interface OneOffWritingUntrusted {
  idea: string;
}

const AUTHORITY = [
  "STAGE: One-off bedtime story writing.",
  "You MAY: write the prose paragraphs that realise the canonical plan, in the",
  "  reading age's register, closing with warmth.",
  "You MAY NOT: change the plan, add a new central problem, contradict any",
  "  canonical fact, exceed the illustration limit, or produce a prohibited outcome.",
  "CANONICAL: the plan, reading age, word-count target, cast, and prohibited",
  "  outcomes in <canonical_context> are fixed.",
  "Return ONLY the structured draft described in <task>.",
].join("\n");

const TASK = [
  "Produce a single JSON draft object with:",
  '- schemaVersion: the exact string "chapter-draft.v1";',
  "- title;",
  "- paragraphs: ordered prose paragraphs that read naturally aloud, near the",
  "  canonical word-count target, using specific sensory detail, closing calmly;",
  "- beatsCovered: the plan beat keys this draft realises (cover every plan beat);",
  "- illustrationAnchors: up to five, each a local kebab-case key, an",
  "  afterParagraph index (0 = before all prose), and a short scene description.",
].join("\n");

export const oneOffWritingPrompt: PromptAsset<
  OneOffWritingCtx,
  OneOffWritingUntrusted
> = {
  purpose: "one-off-writing",
  version: "1.0.0",
  capability: "chapter-writing",
  build({ canonicalContext, untrustedInput }) {
    const system = [GLOBAL_POLICY, "", AUTHORITY].join("\n");
    const prompt = buildRequestEnvelope({
      authority: AUTHORITY,
      canonicalContext,
      untrustedInput: { idea: untrustedInput.idea },
      task: TASK,
      qualityChecks: [
        "Every plan beat key appears in beatsCovered.",
        "The prose stays near the canonical word-count target.",
        "Illustration anchors are within the prose and number five or fewer.",
        "The close is gentle; no prohibited outcome appears.",
        "No database ids appear; only local kebab-case keys.",
      ],
    });
    return { system, prompt };
  },
};
