import type { SafeErrorCode } from "@/lib/errors";

/**
 * OBSERVABILITY contract (M10, `docs/06-engineering/observability.md`). Pure types
 * + a SAFE-event builder. The principle: workflow failures, quality regressions,
 * cost, and latency must be diagnosable BY CORRELATION ID without logging private
 * family content broadly. So a {@link StructuredEvent} carries only IDs + safe
 * codes — never full prose, raw prompts, child-profile details, signed URLs, image
 * bytes, or provider reasoning traces (the "Do not log" list).
 *
 * The named METRICS (`observability.md` "Metrics") are computed from existing
 * tables by the ops query service; the named EVENTS below are emitted at command/
 * stage/publication boundaries through an {@link import("../application/ports/observability-emitter").ObservabilityEmitter}.
 */

/** The named structured events (`observability.md` "Structured events"). */
export const STRUCTURED_EVENTS = [
  "workflow.created",
  "stage.started",
  "stage.completed",
  "retry",
  "fallback",
  "validation.failure",
  "review.decision",
  "revision.requested",
  "continuity.rejected",
  "chapter.published",
  "image.approved",
  "workflow.failed",
] as const;

export type StructuredEventName = (typeof STRUCTURED_EVENTS)[number];

/** The named metrics (`observability.md` "Metrics"), computed from the DB. */
export const NAMED_METRICS = [
  "workflow-success-rate",
  "stage-latency",
  "p95-time-to-approved-text",
  "p95-time-to-first-image",
  "retry-rate",
  "fallback-rate",
  "review-revision-rate",
  "continuity-rejection-rate",
  "identity-failure-rate",
  "accepted-result-cost",
  "provider-availability",
] as const;

export type MetricName = (typeof NAMED_METRICS)[number];

/**
 * The correlation id set carried on every command (`observability.md`
 * "Correlation"). Every field is an ID — safe to log. A failed bedtime generation
 * is diagnosable by these alone.
 */
export interface CorrelationContext {
  requestId: string;
  workflowId?: string;
  familyId?: string;
  storyId?: string;
  seriesId?: string;
  chapterId?: string;
  generationRunId?: string;
}

/** A structured, SAFE-to-log event. `data` is IDs/codes/numbers only. */
export interface StructuredEvent {
  event: StructuredEventName;
  at: string;
  correlation: CorrelationContext;
  /** Safe error code when the event is a failure; never a raw error. */
  code?: SafeErrorCode;
  /** Safe issue code (e.g. a review finding code, a validation kind). */
  issue?: string;
  /** Numeric measures (latency, attempt, cost minor units). */
  measures?: Record<string, number>;
}

/** Keys that must NEVER appear in an event's data (the "Do not log" list). */
const FORBIDDEN_KEYS = new Set([
  "prose",
  "text",
  "paragraphs",
  "body",
  "prompt",
  "system",
  "profile",
  "child",
  "url",
  "signedUrl",
  "bytes",
  "image",
  "reasoning",
]);

/**
 * Build a safe structured event, DROPPING any forbidden or non-safe measure so a
 * careless caller can never leak private content into logs. Pure.
 */
export function buildEvent(input: {
  event: StructuredEventName;
  correlation: CorrelationContext;
  at?: string;
  code?: SafeErrorCode;
  issue?: string;
  measures?: Record<string, number>;
}): StructuredEvent {
  const measures = input.measures
    ? Object.fromEntries(
        Object.entries(input.measures).filter(
          ([k, v]) =>
            typeof v === "number" &&
            Number.isFinite(v) &&
            !FORBIDDEN_KEYS.has(k),
        ),
      )
    : undefined;
  return {
    event: input.event,
    at: input.at ?? new Date().toISOString(),
    correlation: input.correlation,
    code: input.code,
    issue: input.issue,
    ...(measures && Object.keys(measures).length > 0 ? { measures } : {}),
  };
}
