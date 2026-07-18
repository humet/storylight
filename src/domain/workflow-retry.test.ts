import { describe, expect, it } from "vitest";

import {
  DomainError,
  generationFailedError,
  invalidCommandError,
} from "@/lib/errors";
import {
  classifyFailure,
  computeBackoffMs,
  DEFAULT_RETRY_POLICY,
  isRetryExhausted,
  toWorkflowError,
} from "./workflow-retry";

/**
 * The retry policy is pure and safety-critical (`docs/05-backend/background-jobs.md`
 * "Retry"): transient failures retry, but safety rejections, corrupt data,
 * invalid chapter numbers, repeated review failures, and missing references must
 * NEVER be retried into acceptance.
 */

describe("classifyFailure", () => {
  it("retries a domain error that declares itself retryable (e.g. generation)", () => {
    expect(classifyFailure(generationFailedError()).retryable).toBe(true);
  });

  it("never retries a safety rejection, even if flagged retryable", () => {
    const safety = new DomainError({
      code: "SAFETY_REJECTION",
      safeMessage: "This could not be made safely.",
      retryable: true, // even if someone wrongly flags it
    });
    expect(classifyFailure(safety).retryable).toBe(false);
  });

  it("does not retry a non-retryable domain error (corrupt/invalid command)", () => {
    // Invalid chapter number, corrupt canonical data, missing references, and a
    // repeated review failure all surface as non-retryable domain errors.
    expect(classifyFailure(invalidCommandError()).retryable).toBe(false);
  });

  it("retries recognised transient markers on a plain error", () => {
    for (const message of [
      "connect ETIMEDOUT",
      "Rate limit exceeded",
      "Provider returned 503",
      "socket hang up",
      "temporary network blip",
    ]) {
      expect(classifyFailure(new Error(message)).retryable).toBe(true);
    }
  });

  it("does NOT blindly retry an unknown plain error", () => {
    expect(classifyFailure(new Error("something odd")).retryable).toBe(false);
    expect(classifyFailure("weird string throw").retryable).toBe(false);
  });
});

describe("isRetryExhausted", () => {
  it("stops at the policy's maxAttempts (default 3)", () => {
    expect(isRetryExhausted(1)).toBe(false);
    expect(isRetryExhausted(2)).toBe(false);
    expect(isRetryExhausted(3)).toBe(true);
    expect(isRetryExhausted(4)).toBe(true);
  });
});

describe("computeBackoffMs", () => {
  it("grows exponentially from the base and caps at maxDelayMs", () => {
    expect(computeBackoffMs(1)).toBe(DEFAULT_RETRY_POLICY.baseDelayMs); // 500
    expect(computeBackoffMs(2)).toBe(1000);
    expect(computeBackoffMs(3)).toBe(2000);
    // A tiny policy proves the cap.
    const capped = {
      maxAttempts: 100,
      baseDelayMs: 1000,
      maxDelayMs: 1500,
      factor: 10,
    };
    expect(computeBackoffMs(5, capped)).toBe(1500);
  });
});

describe("toWorkflowError", () => {
  it("projects a domain error to the SAFE stored shape (no internals)", () => {
    const error = new DomainError({
      code: "GENERATION_FAILED",
      safeMessage: "That did not come together.",
      internalDetail: "provider stack trace with secrets",
      stage: "paint",
      retryable: true,
    });
    const at = new Date("2026-07-18T00:00:00.000Z");
    const stored = toWorkflowError(error, at);
    expect(stored).toEqual({
      code: "GENERATION_FAILED",
      message: "That did not come together.",
      stage: "paint",
      retryable: true,
      occurredAt: at.toISOString(),
    });
    // The internal detail is nowhere in the serialised, client-visible shape.
    expect(JSON.stringify(stored)).not.toContain("secrets");
  });

  it("flattens a raw error to an opaque GENERATION_FAILED (no provider message)", () => {
    const stored = toWorkflowError(
      new Error("boom at provider xyz"),
      new Date(),
    );
    expect(stored.code).toBe("GENERATION_FAILED");
    expect(stored.message).not.toContain("xyz");
  });
});
