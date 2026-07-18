import { REVIEW_FINDING_CODES } from "@/domain/review-policy";
import { buildRequestEnvelope, GLOBAL_POLICY } from "./global-policy";
import type { PromptAsset } from "./prompt-asset";

/**
 * ONE-OFF REVIEW prompt (`docs/02-storytelling/one-off-stories.md` "Review";
 * `docs/02-storytelling/safety-age-appropriateness.md` "Review severity"). The
 * reviewer produces an ADVISORY artifact only — the application's pure policy
 * makes the final decision. The draft prose is untrusted narrative data; the
 * checklist, safety constraints, and finding vocabulary are canonical.
 */

export interface OneOffReviewCtx {
  readingAge: string;
  suspense: string;
  allowMildPeril: boolean;
  allowDeathGrief: boolean;
  prohibitedOutcomes: string[];
  planExpectations: {
    title: string;
    resolution: string;
    calmingClose: string;
    beatDescriptions: string[];
  };
  findingCodes: readonly string[];
}

export interface OneOffReviewUntrusted {
  paragraphs: string[];
}

const AUTHORITY = [
  "STAGE: One-off bedtime story review (ADVISORY ONLY).",
  "You MAY: assess the draft and report findings and checklist answers.",
  "You MAY NOT: rewrite the story, publish, or decide the outcome — the",
  "  application decides. Do not soften a safety problem to be agreeable.",
  "CANONICAL: the reading age, suspense ceiling, safety flags, plan expectations,",
  "  prohibited outcomes, and the closed finding-code vocabulary are fixed.",
  "Return ONLY the structured review described in <task>.",
].join("\n");

const TASK = [
  "Assess: complete arc, age appropriateness, bedtime suitability,",
  "characterisation, unsupported real-world claims, repetition, a satisfying",
  "resolution, and no sequel dependency. Produce a single JSON review object with:",
  '- schemaVersion: the exact string "chapter-review.v1";',
  "- completeArc, resolvesCentralProblem, endsCalmly, sequelDependency,",
  "  ageAppropriate (booleans; sequelDependency true means it leans on a sequel);",
  "- findings: each a code from the canonical vocabulary, a severity of",
  '  "blocking" | "major" | "minor", and a short evidence note;',
  "- summary: one or two calm sentences.",
].join("\n");

export const oneOffReviewPrompt: PromptAsset<
  OneOffReviewCtx,
  OneOffReviewUntrusted
> = {
  purpose: "one-off-review",
  version: "1.0.0",
  capability: "chapter-review",
  build({ canonicalContext, untrustedInput }) {
    const system = [GLOBAL_POLICY, "", AUTHORITY].join("\n");
    const prompt = buildRequestEnvelope({
      authority: AUTHORITY,
      canonicalContext: {
        ...canonicalContext,
        findingCodes: canonicalContext.findingCodes ?? REVIEW_FINDING_CODES,
      },
      untrustedInput: { paragraphs: untrustedInput.paragraphs },
      task: TASK,
      qualityChecks: [
        "Every finding code is from the canonical vocabulary.",
        "Blocking severities are reserved for genuine safety failures.",
        "The checklist booleans reflect the draft as written.",
      ],
    });
    return { system, prompt };
  },
};
