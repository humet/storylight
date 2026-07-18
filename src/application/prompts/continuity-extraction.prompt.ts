import { buildRequestEnvelope, GLOBAL_POLICY } from "./global-policy";
import type { PromptAsset } from "./prompt-asset";

/**
 * CONTINUITY EXTRACTION prompt (`docs/02-storytelling/continuity.md` "Change-set
 * pattern"). The model proposes the CHANGES a published chapter made to canonical
 * continuity — never the next state (domain rule 3). Application code validates and
 * applies the change set through the pure transition. The prior continuity state,
 * cast keys, and known location keys are canonical; the chapter prose is untrusted
 * narrative data. Knowledge isolation is emphasised: what the reader sees is not
 * automatically character knowledge.
 */

export interface ContinuityExtractionCtx {
  chapterNumber: number;
  characterKeys: string[];
  knownLocationKeys: string[];
  openThreadKeys: string[];
  priorContinuityRecap: unknown;
}

export interface ContinuityExtractionUntrusted {
  paragraphs: string[];
}

const AUTHORITY = [
  "STAGE: Continuity extraction (structured change set only).",
  "You MAY: report the changes THIS chapter made — time and location movement,",
  "  emotions, outfits, possessions, per-character and reader-only knowledge,",
  "  relationships, temporary conditions, plot-thread transitions, discoveries, and",
  "  new or superseded facts.",
  "You MAY NOT: return the full next state, invent characters or locations not in",
  "  the canonical keys, resolve an unintroduced thread, regress a resolved thread,",
  "  or change an immutable fact.",
  "KNOWLEDGE ISOLATION: what the READER sees is NOT automatically character",
  "  knowledge. If a character did not witness something, do not add it to their",
  "  knowledge — put reader-visible-only facts in readerKnowledgeGains.",
  "Return ONLY the structured change set described in <task>.",
].join("\n");

const TASK = [
  "Produce a single JSON continuity-change object with:",
  '- schemaVersion: the exact string "continuity-change.v1";',
  "- currentTime and currentLocationId (null if unchanged);",
  "- the change arrays, each entry using ONLY canonical character/location keys and",
  "  local kebab-case item/outfit/fact/thread keys;",
  "- possessionChanges use one of the possession states; a removal (consumed/lost/",
  "  destroyed/given-away) requires the character to currently hold the item;",
  "- threadTransitions advance the lifecycle (planned→introduced→developing→",
  "  resolved) and never regress.",
].join("\n");

export const continuityExtractionPrompt: PromptAsset<
  ContinuityExtractionCtx,
  ContinuityExtractionUntrusted
> = {
  purpose: "continuity-extraction",
  version: "1.0.0",
  capability: "continuity-extraction",
  build({ canonicalContext, untrustedInput }) {
    const system = [GLOBAL_POLICY, "", AUTHORITY].join("\n");
    const prompt = buildRequestEnvelope({
      authority: AUTHORITY,
      canonicalContext,
      untrustedInput: { paragraphs: untrustedInput.paragraphs },
      task: TASK,
      qualityChecks: [
        "Only canonical character and location keys are referenced.",
        "Reader-only knowledge is never added to character knowledge.",
        "Possession removals only apply to items the character holds.",
        "Thread transitions advance the lifecycle and never regress.",
        "No database ids appear; only local kebab-case keys.",
      ],
    });
    return { system, prompt };
  },
};
