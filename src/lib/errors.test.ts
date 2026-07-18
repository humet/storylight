import { describe, expect, it } from "vitest";
import {
  DomainError,
  isDomainError,
  toClientError,
  unauthorisedError,
} from "./errors";

describe("DomainError", () => {
  it("serialises only client-safe fields, never internals", () => {
    const error = new DomainError({
      code: "GENERATION_FAILED",
      safeMessage: "Generation failed.",
      internalDetail: "provider stack trace with a raw prompt",
      retryable: true,
      stage: "planning",
      cause: new Error("upstream 500"),
    });

    const serialized = JSON.parse(JSON.stringify(error));
    expect(serialized).toEqual({
      code: "GENERATION_FAILED",
      message: "Generation failed.",
      correlationId: error.correlationId,
    });
    // The sensitive fields exist on the object but never reach the wire.
    expect(serialized.internalDetail).toBeUndefined();
    expect(serialized.cause).toBeUndefined();
    expect(serialized.stack).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain("raw prompt");
  });

  it("auto-generates a correlation id when none is supplied", () => {
    const error = unauthorisedError();
    expect(error.correlationId).toBeTruthy();
    expect(isDomainError(error)).toBe(true);
  });

  it("flattens unknown errors to an opaque safe code", () => {
    const client = toClientError(new Error("raw internal boom"));
    expect(client.code).toBe("GENERATION_FAILED");
    expect(client.message).not.toContain("boom");
    expect(client.correlationId).toBeTruthy();
  });
});
