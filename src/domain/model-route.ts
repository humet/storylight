import type { LanguageCapability } from "./model-capability";

/**
 * A MODEL ROUTE VERSION (`docs/03-ai/models.md` "Route versioning", ADR-004/006).
 *
 * A route version is the immutable, source-controlled record of HOW a capability
 * is served: the primary gateway slug, availability-only fallbacks, generation
 * settings, its lifecycle status, an evaluation profile, and an approval record.
 * Routes live in `model_route_versions`; existing series PIN a specific version
 * (M8) via a {@link PinnedRouteProfile} so voice/visual choices never drift when
 * the active route later changes.
 *
 * Pure data only — no provider SDK, no DB row shape. The Drizzle repository maps
 * rows to this type; the model registry resolves it; the structured-generation
 * adapter reads `primaryTarget`/`fallbacks`/`settings` from it.
 */

/** Provider-neutral generation settings applied to a call (adapter maps them). */
export interface GenerationSettings {
  /** Sampling temperature. Omitted → provider default. */
  temperature?: number;
  /** Hard ceiling on output tokens (also feeds the budget). */
  maxOutputTokens: number;
  /** Nucleus sampling. Omitted → provider default. */
  topP?: number;
}

/**
 * Route lifecycle. A route cannot become `active` until it passes the evaluation
 * gate (`docs/03-ai/models.md` "Evaluation gate"), enforced in M10; M6 seeds the
 * default set directly as `active` with a bootstrap approval record so the
 * pipeline is exercisable, and records that provenance in the approval record.
 */
export type RouteLifecycleStatus =
  "draft" | "active" | "deprecated" | "retired";

export const ROUTE_LIFECYCLE_STATUSES: readonly RouteLifecycleStatus[] = [
  "draft",
  "active",
  "deprecated",
  "retired",
];

/** Who approved a route for activation and when (the evaluation gate's record). */
export interface ApprovalRecord {
  approvedBy: string;
  /** ISO-8601 timestamp. */
  approvedAt: string;
  /** Free-text provenance (e.g. "M6 bootstrap seed — pending M10 evaluation"). */
  note?: string;
  /** The evaluation run that cleared the gate, once M10 exists. */
  evaluationRunId?: string;
}

/**
 * A CANARY rollout rule (`docs/03-ai/evaluation.md` "Shadow and canary",
 * `docs/06-engineering/deployment.md` "Feature flags"). A canary route applies
 * only to NEWLY created stories/series; the chosen arm is then PINNED per series
 * (M8 pinning), so existing series never drift. `rolloutPercent` is the share of
 * NEW stories routed to the canary (0–100); the assignment is a pure,
 * deterministic hash of the story/series key (see `resolveRolloutRoute`).
 */
export interface CanaryRule {
  rolloutPercent: number;
  note?: string;
}

export interface ModelRouteVersion {
  /** App-generated id (never model-generated). */
  id: string;
  capability: LanguageCapability;
  /** Semantic version of THIS route ("1.0.0"). `(capability, version)` is unique. */
  version: string;
  /** Primary gateway slug (e.g. "anthropic/claude-sonnet-5"). No mutable aliases. */
  primaryTarget: string;
  /** Availability-only fallbacks, tried in order (never to bypass review). */
  fallbacks: string[];
  settings: GenerationSettings;
  lifecycleStatus: RouteLifecycleStatus;
  /** Evaluation profile name (M10 evaluation runner); null until evaluated. */
  evaluationProfile: string | null;
  /** Approval record; null until the route is approved. */
  approvalRecord: ApprovalRecord | null;
  /** Whether this is the capability's active CANARY (vs the baseline). */
  isCanary: boolean;
  /** Rollout rule when `isCanary`; null otherwise. */
  canaryRule: CanaryRule | null;
}

/** Which arm a new story was routed to (recorded/pinned per series). */
export type RolloutArm = "baseline" | "canary";

/**
 * Deterministic 0–99 bucket for a story/series key (FNV-1a hash). Pure — the same
 * key always lands in the same bucket, so a canary assignment is stable if it were
 * ever recomputed, and the pin is the source of truth thereafter.
 */
export function rolloutBucket(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 100;
}

/**
 * Choose the route for a NEWLY created story/series. When a canary exists for the
 * capability, its `rolloutPercent` share of new-story keys is routed to it; the
 * rest (and the case with no canary) use the baseline. This is called ONLY at
 * creation time — the result is pinned into the series, so an existing series is
 * never re-routed (the new-only rule).
 */
export function resolveRolloutRoute(input: {
  storyKey: string;
  baseline: ModelRouteVersion;
  canary?: ModelRouteVersion | null;
}): { route: ModelRouteVersion; arm: RolloutArm } {
  const { storyKey, baseline, canary } = input;
  if (
    canary &&
    canary.isCanary &&
    canary.canaryRule &&
    rolloutBucket(storyKey) < canary.canaryRule.rolloutPercent
  ) {
    return { route: canary, arm: "canary" };
  }
  return { route: baseline, arm: "baseline" };
}

/**
 * A per-series PIN mapping a capability to a specific route version id
 * (`docs/03-ai/models.md` "Existing series pin their route versions"). Populated
 * in M8; designed now so the shape is stable. Absent capability → resolve the
 * active route.
 */
export type PinnedRouteProfile = Partial<Record<LanguageCapability, string>>;
