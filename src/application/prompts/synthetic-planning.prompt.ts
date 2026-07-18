import { buildRequestEnvelope, GLOBAL_POLICY } from "./global-policy";
import type { PromptAsset } from "./prompt-asset";

/**
 * The SYNTHETIC planning prompt (M6). Pairs with `synthetic-plan.schema.ts` to
 * exercise the full pipeline without pre-building M7's real one-off planning
 * prompt. Demonstrates the envelope contract: fixed authority + task in the
 * system/task sections, untrusted parent input serialised into
 * `<untrusted_input>`, and quality checks that map to the wire + domain
 * validators.
 */

export interface SyntheticPlanningCtx {
  /** Trusted, structured planning constraints (canonical). */
  ageBand: string;
  maxBeats: number;
}

export interface SyntheticPlanningUntrusted {
  /** The parent's free-text story idea — untrusted narrative data. */
  idea: string;
}

const AUTHORITY = [
  "STAGE: Synthetic story planning.",
  "You MAY: choose a title, a one-paragraph summary, a small cast, and ordered beats.",
  "You MAY NOT: write prose chapters, decide safety policy, or assign database ids.",
  "CANONICAL: the age band and beat limit in <canonical_context> are fixed.",
  "Return ONLY the structured plan described in <task>.",
].join("\n");

const TASK = [
  "Produce a story plan as a single JSON object with:",
  '- schemaVersion: the exact string "synthetic-plan.v1";',
  "- title and summary;",
  "- characters: 1-6 entries, each with a local kebab-case key and a name;",
  "- beats: ordered entries, each with a local kebab-case key, a characterKey",
  "  that MUST match one of the character keys, and a short action.",
].join("\n");

export const syntheticPlanningPrompt: PromptAsset<
  SyntheticPlanningCtx,
  SyntheticPlanningUntrusted
> = {
  purpose: "synthetic-planning",
  version: "1.0.0",
  capability: "one-off-planning",
  build({ canonicalContext, untrustedInput }) {
    const system = [GLOBAL_POLICY, "", AUTHORITY].join("\n");

    const prompt = buildRequestEnvelope({
      authority: AUTHORITY,
      canonicalContext: {
        ageBand: canonicalContext.ageBand,
        maxBeats: canonicalContext.maxBeats,
      },
      untrustedInput: { idea: untrustedInput.idea },
      task: TASK,
      qualityChecks: [
        "Every beat.characterKey matches a character.key.",
        "Character keys and beat keys are each unique.",
        "No beat count exceeds the canonical maxBeats.",
        "No database ids appear anywhere; only local kebab-case keys.",
      ],
    });

    return { system, prompt };
  },
};
