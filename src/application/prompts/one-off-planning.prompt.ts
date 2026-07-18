import { buildRequestEnvelope, GLOBAL_POLICY } from "./global-policy";
import type { PromptAsset } from "./prompt-asset";

/**
 * ONE-OFF PLANNING prompt (`docs/02-storytelling/one-off-stories.md` "Planning";
 * `docs/03-ai/prompts.md`). Elaborates the canonical Story DNA into a complete
 * plan before any prose. Fixed authority + task; the Story DNA is trusted
 * canonical context; the parent's idea and optional theme are untrusted narrative
 * data serialised into `<untrusted_input>`.
 */

export interface OneOffPlanningCtx {
  readingAge: string;
  tone: string;
  suspense: string;
  targetReadingMinutes: number;
  wordCountTarget: { min: number; max: number };
  beatTarget: { min: number; max: number };
  characters: { key: string; name: string; apparentAge: number }[];
  prohibitedOutcomes: string[];
  allowMildPeril: boolean;
  allowDeathGrief: boolean;
}

export interface OneOffPlanningUntrusted {
  idea: string;
  theme: string | null;
}

const AUTHORITY = [
  "STAGE: One-off bedtime story planning.",
  "You MAY: choose the title, setting, the protagonist's desire and obstacle, an",
  "  emotional theme, ordered beats, a climax, a resolution, and a calming close.",
  "You MAY NOT: write prose, decide safety policy, change any canonical value, or",
  "  assign database ids. Use the supplied character keys exactly.",
  "CANONICAL: the reading age, tone, suspense ceiling, word-count target, beat",
  "  band, cast, and prohibited outcomes in <canonical_context> are fixed.",
  "Return ONLY the structured plan described in <task>.",
].join("\n");

const TASK = [
  "Produce a single JSON plan object with:",
  '- schemaVersion: the exact string "one-off-plan.v1";',
  "- title, setting, protagonistDesire, obstacle, emotionalTheme;",
  "- protagonistKey: MUST equal one of the canonical character keys;",
  "- beats: an ordered list within the canonical beat band, each with a local",
  "  kebab-case key and a short description; one central problem, one emotional",
  "  movement — not a compressed multi-chapter series;",
  "- climax, resolution, calmingClose. The central problem MUST resolve; the",
  "  close MUST be gentle and bedtime-suitable, with no unresolved sequel hook.",
].join("\n");

export const oneOffPlanningPrompt: PromptAsset<
  OneOffPlanningCtx,
  OneOffPlanningUntrusted
> = {
  purpose: "one-off-planning",
  version: "1.0.0",
  capability: "one-off-planning",
  build({ canonicalContext, untrustedInput }) {
    const system = [GLOBAL_POLICY, "", AUTHORITY].join("\n");
    const prompt = buildRequestEnvelope({
      authority: AUTHORITY,
      canonicalContext,
      untrustedInput: {
        idea: untrustedInput.idea,
        theme: untrustedInput.theme,
      },
      task: TASK,
      qualityChecks: [
        "protagonistKey matches a canonical character key.",
        "Beat keys are unique; the beat count is within the canonical band.",
        "The central problem resolves and the close is calm.",
        "No prohibited outcome appears anywhere in the plan.",
        "No database ids appear; only local kebab-case keys.",
      ],
    });
    return { system, prompt };
  },
};
