/**
 * Typed domain errors.
 *
 * Every error carries the fields `docs/06-engineering/coding-standards.md`
 * mandates — code, safe message, internal detail, retryability, stage,
 * correlation ID — but only the SAFE subset is ever serialized to a client.
 * Raw internals (`internalDetail`, `cause`, `stack`) never cross the wire; see
 * `docs/05-backend/api.md` "Error contract" and domain rule 12.
 */

/**
 * The only error codes a client may receive (`docs/05-backend/api.md`).
 * Anything not expressible as one of these must be mapped before it leaves the
 * server.
 */
export type SafeErrorCode =
  | "INVALID_COMMAND"
  | "UNAUTHORISED"
  | "SERIES_COMPLETE"
  | "WORKFLOW_LOCKED"
  | "SAFETY_REJECTION"
  | "GENERATION_FAILED"
  | "IMAGE_PENDING";

export interface DomainErrorInit {
  code: SafeErrorCode;
  /** Human-readable, client-safe message. Contains no internals. */
  safeMessage: string;
  /** Server-only diagnostic detail. Never serialized to a client. */
  internalDetail?: string;
  /** Whether retrying the same operation could plausibly succeed. */
  retryable?: boolean;
  /** Pipeline stage the failure occurred in (e.g. "auth", "planning"). */
  stage?: string;
  /** Correlation id tying client-facing errors to server logs. */
  correlationId?: string;
  /** Underlying cause, kept server-side only. */
  cause?: unknown;
}

/** The shape safe to send to a client. Deliberately minimal. */
export interface ClientError {
  code: SafeErrorCode;
  message: string;
  correlationId: string;
}

function newCorrelationId(): string {
  const globalCrypto = globalThis.crypto;
  if (globalCrypto?.randomUUID) return globalCrypto.randomUUID();
  // Extremely defensive fallback for runtimes without WebCrypto.
  return `cid_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export class DomainError extends Error {
  readonly code: SafeErrorCode;
  readonly safeMessage: string;
  readonly internalDetail?: string;
  readonly retryable: boolean;
  readonly stage?: string;
  readonly correlationId: string;

  constructor(init: DomainErrorInit) {
    // The Error `message` is the SAFE message: even if this leaks to a generic
    // logger or `String(err)`, no internals are exposed.
    super(
      init.safeMessage,
      init.cause !== undefined ? { cause: init.cause } : undefined,
    );
    this.name = "DomainError";
    this.code = init.code;
    this.safeMessage = init.safeMessage;
    this.internalDetail = init.internalDetail;
    this.retryable = init.retryable ?? false;
    this.stage = init.stage;
    this.correlationId = init.correlationId ?? newCorrelationId();
  }

  /** Project to the client-safe shape. This is the ONLY serialization path. */
  toClientError(): ClientError {
    return {
      code: this.code,
      message: this.safeMessage,
      correlationId: this.correlationId,
    };
  }

  /**
   * Guarantee that `JSON.stringify(error)` — however it is reached — emits only
   * client-safe fields, never `internalDetail`, `cause`, or `stack`.
   */
  toJSON(): ClientError {
    return this.toClientError();
  }
}

export function isDomainError(value: unknown): value is DomainError {
  return value instanceof DomainError;
}

/**
 * Map any thrown value to its client-safe representation. Non-domain errors are
 * flattened to an opaque `GENERATION_FAILED` so raw provider/runtime errors can
 * never reach a client (domain rule 12, `docs/05-backend/api.md`).
 */
export function toClientError(value: unknown): ClientError {
  if (isDomainError(value)) return value.toClientError();
  return new DomainError({
    code: "GENERATION_FAILED",
    safeMessage: "Something went wrong. Please try again.",
    internalDetail: value instanceof Error ? value.message : String(value),
    cause: value,
  }).toClientError();
}

/** Convenience constructor for the common unauthorised case. */
export function unauthorisedError(
  init: Partial<Omit<DomainErrorInit, "code">> = {},
): DomainError {
  return new DomainError({
    code: "UNAUTHORISED",
    safeMessage: init.safeMessage ?? "You need to sign in to continue.",
    stage: init.stage ?? "auth",
    ...init,
  });
}

/** Convenience constructor for invalid-command / validation failures. */
export function invalidCommandError(
  init: Partial<Omit<DomainErrorInit, "code">> = {},
): DomainError {
  return new DomainError({
    code: "INVALID_COMMAND",
    safeMessage: init.safeMessage ?? "That request could not be processed.",
    ...init,
  });
}
