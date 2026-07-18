import { buildRequestEnvelope, GLOBAL_POLICY } from "./global-policy";
import type { PromptAsset } from "./prompt-asset";

/**
 * SERIES PLANNING prompt (`docs/02-storytelling/story-series.md` "Series creation";
 * `docs/03-ai/prompts.md`). Elaborates the canonical Story DNA + the parent's idea
 * into a COMPLETE series bible BEFORE Chapter 1 (domain rule 1). The reading
 * constraints, cast keys, chapter count, and prohibited outcomes are trusted
 * canonical context; the parent's idea + optional theme are untrusted narrative
 * data. The bible is spoiler-bearing and stays server-side.
 */

export interface SeriesPlanningCtx {
  readingAge: string;
  tone: string;
  suspense: string;
  chapterCount: number;
  characters: { key: string; name: string; apparentAge: number }[];
  prohibitedOutcomes: string[];
  allowMildPeril: boolean;
  allowDeathGrief: boolean;
}

export interface SeriesPlanningUntrusted {
  idea: string;
  theme: string | null;
}

const AUTHORITY = [
  "STAGE: Complete series planning (the whole series before any chapter is written).",
  "You MAY: choose the title, a spoiler-free premise, an internal synopsis, the",
  "  emotional promise, world rules and locations, the cast's roles, the central",
  "  question and conflict, the planned ending, character arcs, plot threads, one",
  "  blueprint per chapter, immutable facts, and forbidden developments.",
  "You MAY NOT: write prose, change any canonical value, exceed or shorten the",
  "  canonical chapter count, or assign database ids. Use the supplied cast keys",
  "  exactly and invent local kebab-case keys for locations, threads, and facts.",
  "CANONICAL: the reading age, tone, suspense ceiling, chapter count, cast, and",
  "  prohibited outcomes in <canonical_context> are fixed.",
  "Return ONLY the structured series bible described in <task>.",
].join("\n");

const TASK = [
  "Produce a single JSON series-bible object with:",
  '- schemaVersion: the exact string "series-bible.v1";',
  "- title, spoilerFreePremise, internalSynopsis, emotionalPromise;",
  "- worldRules: a few clear, testable rules; locations: keyed places, with a",
  "  startingLocationKey that is one of them;",
  "- cast: each canonical character key with a role; characterArcs for each;",
  "- centralQuestion, centralConflict, plannedEnding (a calm, reassuring ending);",
  "- plotThreads: each a local key, description, introduceInChapter and",
  "  resolveInChapter within 1..chapterCount, and central=true for the thread(s)",
  "  carrying the central question. EVERY thread must be introduced AND resolved",
  "  within the plan, and every central thread MUST resolve in the final chapter;",
  "- chapterBlueprints: EXACTLY one per chapter 1..chapterCount, each with a",
  "  narrativePurpose, openingState, localGoal, conflict, majorBeats, emotional",
  "  movement, informationRevealed, threadsIntroduced/Advanced/Resolved (consistent",
  "  with the thread plan), a closingState, and a gentle tomorrowPromise;",
  "- immutableFacts and forbiddenDevelopments.",
].join("\n");

export const seriesPlanningPrompt: PromptAsset<
  SeriesPlanningCtx,
  SeriesPlanningUntrusted
> = {
  purpose: "series-planning",
  version: "1.0.0",
  capability: "series-planning",
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
        "Exactly one blueprint per chapter, numbered 1..chapterCount.",
        "Every plot thread is introduced and resolved within the plan.",
        "Every central thread resolves in the final chapter.",
        "The planned ending is calm and reassuring; no prohibited outcome appears.",
        "Cast keys match the canonical keys; only local kebab-case keys otherwise.",
      ],
    });
    return { system, prompt };
  },
};
