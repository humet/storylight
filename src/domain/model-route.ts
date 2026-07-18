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
}

/**
 * A per-series PIN mapping a capability to a specific route version id
 * (`docs/03-ai/models.md` "Existing series pin their route versions"). Populated
 * in M8; designed now so the shape is stable. Absent capability → resolve the
 * active route.
 */
export type PinnedRouteProfile = Partial<Record<LanguageCapability, string>>;
