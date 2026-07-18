import { isDomainError } from "@/lib/errors";
import type { WorkflowError } from "./workflow";

/**
 * The pure retry policy (`docs/05-backend/background-jobs.md` "Retry"). Decides
 * (a) whether a failure is worth retrying at all, (b) whether attempts are
 * exhausted, and (c) how long to back off before the next attempt — all as pure,
 * exhaustively-tested functions with no IO.
 *
 * Retry temporary failures: timeouts, rate limits, transient network/storage.
 * NEVER blindly retry: safety rejections, corrupt canonical data, an invalid
 * chapter number, a repeated review failure, or missing character references.
 */

export interface RetryPolicy {
  /** Total attempts allowed, INCLUDING the first (so 3 = first + 2 retries). */
  maxAttempts: number;
  /** Base back-off in milliseconds for the first retry. */
  baseDelayMs: number;
  /** Ceiling on any single back-off. */
  maxDelayMs: number;
  /** Exponential growth factor per attempt. */
  factor: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 30_000,
  factor: 2,
};

export interface RetryClassification {
  retryable: boolean;
  /** Short machine reason for logs/observability (never client-facing). */
  reason: string;
}

/** Case-insensitive markers of a transient failure on a non-domain error. */
const TRANSIENT_MARKERS = [
  "timeout",
  "etimedout",
  "econnreset",
  "econnrefused",
  "eai_again",
  "rate limit",
  "rate-limit",
  "429",
  "503",
  "network",
  "socket hang up",
  "transient",
  "temporarily",
];

/**
 * Classify a thrown value as retryable or not.
 *
 *  - `DomainError`: its own `retryable` flag is authoritative — the failing code
 *    already knows whether the failure is transient. A `SAFETY_REJECTION` is
 *    hard-forced non-retryable regardless of any flag (a safety block must never
 *    be retried into acceptance — `docs/03-ai/orchestration.md` "Fallbacks").
 *  - Any other error: retry ONLY when the message/name carries a recognised
 *    transient marker. Unknown failures are NOT blindly retried
 *    (`docs/05-backend/background-jobs.md`).
 */
export function classifyFailure(error: unknown): RetryClassification {
  if (isDomainError(error)) {
    if (error.code === "SAFETY_REJECTION") {
      return { retryable: false, reason: "safety-rejection" };
    }
    return {
      retryable: error.retryable,
      reason: error.retryable
        ? `domain:${error.code}:retryable`
        : `domain:${error.code}`,
    };
  }

  const haystack = (
    error instanceof Error ? `${error.name} ${error.message}` : String(error)
  ).toLowerCase();
  const marker = TRANSIENT_MARKERS.find((m) => haystack.includes(m));
  if (marker) return { retryable: true, reason: `transient:${marker}` };
  return { retryable: false, reason: "non-retryable-unknown" };
}

/**
 * Whether `attemptsMade` (the count of attempts including the one that just
 * failed) has reached the policy's ceiling.
 */
export function isRetryExhausted(
  attemptsMade: number,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
): boolean {
  return attemptsMade >= policy.maxAttempts;
}

/**
 * Exponential back-off (capped) for the retry AFTER `attemptsMade` attempts.
 * `attemptsMade = 1` → `baseDelayMs`; each subsequent attempt multiplies by
 * `factor`, capped at `maxDelayMs`. Deterministic (no jitter) so tests are
 * reproducible; jitter can be layered on by the dispatcher if needed.
 */
export function computeBackoffMs(
  attemptsMade: number,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
): number {
  const exponent = Math.max(0, attemptsMade - 1);
  const raw = policy.baseDelayMs * policy.factor ** exponent;
  return Math.min(raw, policy.maxDelayMs);
}

/** Project a thrown value to the SAFE {@link WorkflowError} stored on the row. */
export function toWorkflowError(
  error: unknown,
  occurredAt: Date,
): WorkflowError {
  if (isDomainError(error)) {
    return {
      code: error.code,
      message: error.safeMessage,
      stage: error.stage,
      retryable: error.retryable,
      occurredAt: occurredAt.toISOString(),
    };
  }
  // Non-domain errors are flattened to an opaque GENERATION_FAILED — a raw
  // provider/runtime message must never reach the stored, client-visible error.
  return {
    code: "GENERATION_FAILED",
    message: "Something went wrong while working on this. You can try again.",
    retryable: classifyFailure(error).retryable,
    occurredAt: occurredAt.toISOString(),
  };
}
