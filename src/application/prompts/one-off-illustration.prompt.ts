import { buildRequestEnvelope, GLOBAL_POLICY } from "./global-policy";
import type { PromptAsset } from "./prompt-asset";

/**
 * ONE-OFF ILLUSTRATION PLANNING prompt (`docs/02-storytelling/story-engine.md`
 * "Illustration plan"; `docs/03-ai/image-generation.md`). Plans illustration
 * SPECIFICATIONS only — no images are generated in M7. The valid anchor keys and
 * cast are canonical; the prose and the anchor descriptions are untrusted.
 */

export interface OneOffIllustrationCtx {
  tone: string;
  maxIllustrations: number;
  anchorKeys: string[];
  characters: { key: string; name: string }[];
}

export interface OneOffIllustrationUntrusted {
  paragraphs: string[];
  anchors: { key: string; afterParagraph: number; description: string }[];
}

const AUTHORITY = [
  "STAGE: One-off illustration planning (specifications only).",
  "You MAY: for each marked anchor, write a caption, a scene description, and pick",
  "  an aspect ratio suited to the moment.",
  "You MAY NOT: invent new anchors, exceed the maximum, generate images, or use",
  "  any anchor key not listed in <canonical_context>.",
  "CANONICAL: the valid anchor keys, cast, and maximum count are fixed.",
  "Return ONLY the structured illustration plan described in <task>.",
].join("\n");

const TASK = [
  "Produce a single JSON illustration-plan object with:",
  '- schemaVersion: the exact string "illustration-plan.v1";',
  "- illustrations: one entry per anchor you illustrate, each with an anchorKey",
  "  (from the canonical list), a caption, a scene description, and an aspect of",
  '  "portrait" | "landscape" | "square". Do not exceed the maximum count.',
].join("\n");

export const oneOffIllustrationPrompt: PromptAsset<
  OneOffIllustrationCtx,
  OneOffIllustrationUntrusted
> = {
  purpose: "one-off-illustration",
  version: "1.0.0",
  capability: "illustration-planning",
  build({ canonicalContext, untrustedInput }) {
    const system = [GLOBAL_POLICY, "", AUTHORITY].join("\n");
    const prompt = buildRequestEnvelope({
      authority: AUTHORITY,
      canonicalContext,
      untrustedInput: {
        paragraphs: untrustedInput.paragraphs,
        anchors: untrustedInput.anchors,
      },
      task: TASK,
      qualityChecks: [
        "Every anchorKey is from the canonical list.",
        "The number of illustrations does not exceed the maximum.",
        "Captions are calm and child-appropriate.",
      ],
    });
    return { system, prompt };
  },
};
