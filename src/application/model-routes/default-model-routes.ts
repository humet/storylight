import type { LanguageCapability } from "@/domain/model-capability";
import type { ModelRouteVersion } from "@/domain/model-route";
import {
  BASELINE_FIXTURE_SET_ID,
  BASELINE_REPORT_ID,
} from "../evaluation/baseline-evaluation";

/**
 * The SEEDED, source-controlled DEFAULT ROUTE SET (`docs/03-ai/models.md`
 * "Initial routing hypothesis", ADR-006). This TS module is the source of truth;
 * the matching migration inserts the SAME rows (same fixed ids) so an empty →
 * migrated database already has routes, and `default-model-routes.test.ts` +
 * the DB seed test guard the two against drift.
 *
 * Model choices follow ADR-006's hypothesis: Claude Sonnet tier for planning /
 * writing, Claude Haiku tier for continuity extraction, and a DIFFERENT family
 * (Gemini) for review. Slugs are current gateway model ids (verified against the
 * gateway model list at implementation time) — never mutable `latest` aliases;
 * the resolved provider id is recorded per run. Fallbacks are availability-only.
 *
 * EVALUATION GATE (M10): `docs/03-ai/models.md` requires the evaluation gate
 * before a route goes `active`. M6 seeded these `active` with a bootstrap
 * approval; M10 REPLACES that with a real evaluation approval referencing the
 * `local-fake` baseline report (`baseline-evaluation.ts`, mirrored by the seed
 * migration's UPDATE + the `evaluation_approvals` rows). This module reflects the
 * END state `getActiveRoute` returns; `RouteLifecycleService` enforces the gate on
 * any future activation.
 */

const APPROVED_AT = "2026-07-18T00:00:00.000Z";

function evaluationApproval(): NonNullable<
  ModelRouteVersion["approvalRecord"]
> {
  return {
    approvedBy: "system:m10-evaluation",
    approvedAt: APPROVED_AT,
    note: "Superseded by M10 evaluation approval (local-fake baseline).",
    evaluationRunId: BASELINE_REPORT_ID,
  };
}

/** Fixed ids (deterministic name-based UUIDs over the capability + version). */
const ROUTE_IDS: Record<LanguageCapability, string> = {
  "one-off-planning": "b5cefd48-c5c8-5d0f-a81c-c357a9f1dd32",
  "series-planning": "02a38cf0-3d3f-51c0-83c4-f3ce39ee2778",
  "chapter-planning": "d0ff797a-1ddc-52ff-9a95-796812b5d71f",
  "chapter-writing": "9a04a6c5-9cb3-51da-b40c-1f17feac5bd9",
  "chapter-review": "091e716d-93e6-5b7c-aa69-9b09ec1032e1",
  "chapter-revision": "cb558c87-6593-553e-9f24-2de420cb9524",
  "continuity-extraction": "dac4a447-9aec-5c02-bbfe-501fd79c9837",
  "illustration-planning": "fd4d2bd5-cf23-5ee9-963d-d57268d5e88d",
  "illustration-review": "461e843a-be7c-5b0e-b092-7a98fb5b1f6e",
};

interface RouteSeed {
  capability: LanguageCapability;
  primaryTarget: string;
  fallbacks: string[];
  temperature: number;
  maxOutputTokens: number;
}

const SEEDS: RouteSeed[] = [
  {
    capability: "one-off-planning",
    primaryTarget: "anthropic/claude-sonnet-5",
    fallbacks: ["anthropic/claude-sonnet-4.6"],
    temperature: 0.6,
    maxOutputTokens: 4000,
  },
  {
    capability: "series-planning",
    // Strongest reasoning model for series planning.
    primaryTarget: "anthropic/claude-opus-4.8",
    fallbacks: ["anthropic/claude-sonnet-5"],
    temperature: 0.6,
    maxOutputTokens: 8000,
  },
  {
    capability: "chapter-planning",
    primaryTarget: "anthropic/claude-sonnet-5",
    fallbacks: ["anthropic/claude-sonnet-4.6"],
    temperature: 0.5,
    maxOutputTokens: 4000,
  },
  {
    capability: "chapter-writing",
    // Prose-strong model for chapter writing.
    primaryTarget: "anthropic/claude-sonnet-5",
    fallbacks: ["anthropic/claude-sonnet-4.6"],
    temperature: 0.8,
    maxOutputTokens: 8000,
  },
  {
    capability: "chapter-review",
    // Separate model FAMILY for review (Gemini).
    primaryTarget: "google/gemini-3.5-flash",
    fallbacks: ["google/gemini-3.1-flash-lite"],
    temperature: 0.2,
    maxOutputTokens: 4000,
  },
  {
    capability: "chapter-revision",
    primaryTarget: "anthropic/claude-sonnet-5",
    fallbacks: ["anthropic/claude-sonnet-4.6"],
    temperature: 0.7,
    maxOutputTokens: 8000,
  },
  {
    capability: "continuity-extraction",
    // Balanced, lower-cost model for the structured extraction task.
    primaryTarget: "anthropic/claude-haiku-4.5",
    fallbacks: ["anthropic/claude-sonnet-4.6"],
    temperature: 0.1,
    maxOutputTokens: 4000,
  },
  {
    capability: "illustration-planning",
    primaryTarget: "anthropic/claude-sonnet-5",
    fallbacks: ["anthropic/claude-sonnet-4.6"],
    temperature: 0.4,
    maxOutputTokens: 4000,
  },
  {
    capability: "illustration-review",
    // Different family for review.
    primaryTarget: "google/gemini-3.5-flash",
    fallbacks: ["google/gemini-3.1-flash-lite"],
    temperature: 0.2,
    maxOutputTokens: 2000,
  },
];

export const DEFAULT_MODEL_ROUTES: ModelRouteVersion[] = SEEDS.map((seed) => ({
  id: ROUTE_IDS[seed.capability],
  capability: seed.capability,
  version: "1.0.0",
  primaryTarget: seed.primaryTarget,
  fallbacks: seed.fallbacks,
  settings: {
    temperature: seed.temperature,
    maxOutputTokens: seed.maxOutputTokens,
  },
  lifecycleStatus: "active",
  evaluationProfile: BASELINE_FIXTURE_SET_ID,
  approvalRecord: evaluationApproval(),
  isCanary: false,
  canaryRule: null,
}));
