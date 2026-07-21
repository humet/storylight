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
  "You MAY: for each marked anchor, write a caption, a scene description, pick an",
  "  aspect ratio, and declare the scene's recurring non-child companions, its",
  "  setting/time-of-day, and the child's wardrobe, all drawn from what the story",
  "  text actually shows.",
  "You MAY NOT: invent new anchors, exceed the maximum, generate images, or use",
  "  any anchor key not listed in <canonical_context>.",
  "CANONICAL: the valid anchor keys, cast, and maximum count are fixed. The",
  "  companions, setting and wardrobe you declare become canonical scene facts —",
  "  describe what the prose shows; do NOT invent a companion, a setting, or an",
  "  outfit change the text does not mention.",
  "Return ONLY the structured illustration plan described in <task>.",
].join("\n");

const TASK = [
  "Produce a single JSON illustration-plan object with:",
  '- schemaVersion: the exact string "illustration-plan.v3";',
  "- illustrations: one entry per anchor you illustrate, each with an anchorKey",
  "  (from the canonical list), a caption, a scene description, and an aspect of",
  '  "portrait" | "landscape" | "square". Do not exceed the maximum count.',
  "  Each entry MAY also include:",
  "  - companions: the recurring NON-CHILD characters visible in that scene (a pet,",
  "    animal friend, or creature). For each give a short semantic key (e.g.",
  '    "pip-the-owl"), its species (e.g. "owl"), and a short appearance note. Omit',
  "    or use an empty list when the scene has no such companion.",
  "  - setting: an object with a short location and a timeOfDay chosen from EXACTLY",
  '    "day" | "dawn" | "dusk" | "night" (match the story — a bedtime scene is',
  '    usually "night" or "dusk").',
  "  - wardrobe: the state-KEY naming what the child is wearing in this scene. Omit",
  '    it (or use "everyday") whenever the child is in their normal, everyday',
  "    clothes — this is the default and needs no declaration. Use another key ONLY",
  "    when the story text CLEARLY dresses the child differently for that moment.",
  "- wardrobeStates: OPTIONAL. If — and ONLY if — the story text motivates the child",
  "  wearing something other than their everyday clothes at some point, declare each",
  '  such outfit ONCE here as a { key, appearance } pair (e.g. key "pyjamas",',
  '  appearance "star-print flannel pyjamas"). Then reference the key from each',
  "  scene's wardrobe field. Declare a state at most once; do NOT declare or use the",
  '  reserved key "everyday" (it always means the child\'s normal clothes). Omit this',
  "  field entirely when the child stays in everyday clothes throughout.",
].join("\n");

export const oneOffIllustrationPrompt: PromptAsset<
  OneOffIllustrationCtx,
  OneOffIllustrationUntrusted
> = {
  purpose: "one-off-illustration",
  version: "1.2.0",
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
        "Any companion, setting or wardrobe reflects the story text, not invented detail.",
        'Every timeOfDay is one of "day" | "dawn" | "dusk" | "night".',
        'Every scene wardrobe is "everyday" or a key declared in wardrobeStates.',
      ],
    });
    return { system, prompt };
  },
};
