import {
  APICallError,
  createGateway,
  generateText,
  NoObjectGeneratedError,
  Output,
  type FinishReason,
  type LanguageModelUsage,
} from "ai";

import type {
  LanguageModel,
  LanguageModelRequest,
  LanguageModelResponse,
  ModelFinishReason,
} from "@/application/ports/language-model";
import type { TokenUsage } from "@/domain/generation-run";
import { generationFailedError } from "@/lib/errors";

/**
 * The REAL structured-generation adapter (`docs/03-ai/structured-output.md`,
 * ADR-006). It is the ONLY module that imports the Vercel AI SDK (`ai`) — the
 * ESLint boundary fences `ai` to `src/adapters/**`, so provider SDKs never leak
 * into domain or frontend code (domain rule 12).
 *
 * Models are addressed as GATEWAY SLUGS through the AI Gateway. The credential
 * is passed EXPLICITLY to `createGateway` (`AI_GATEWAY_API_KEY`, or the Vercel
 * `VERCEL_OIDC_TOKEN` that Vercel auto-injects and rotates) rather than left to
 * the SDK's ambient auto-detection — the latter does not fire inside the WDK
 * `"use step"` execution context, so a story would fail immediately with a
 * non-retryable provider rejection. It uses the mandated `generateText` +
 * `Output.object` API — never a deprecated object-generation API. `Output.object` gives the provider structural
 * guidance, but this adapter returns the RAW `text` so the application pipeline
 * owns parse → validate → the repair ladder; on a `NoObjectGeneratedError` it
 * still returns the raw text (so the pipeline can classify + repair) rather than
 * throwing. Only genuine AVAILABILITY failures throw (retryable) so the pipeline
 * can try the route's fallbacks.
 *
 * NOTE: there is no `AI_GATEWAY_API_KEY` in this environment and CI never makes
 * paid calls, so this adapter is CONTRACT-TYPED against `ai@7` but never executed
 * by tests — every test runs on the scriptable fake. It is exercised for real by
 * the M10 evaluation gate.
 */

function mapUsage(usage: LanguageModelUsage | undefined): TokenUsage {
  return {
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    totalTokens: usage?.totalTokens ?? 0,
  };
}

function mapFinishReason(reason: FinishReason | undefined): ModelFinishReason {
  switch (reason) {
    case "length":
      return "length";
    case "content-filter":
      return "content-filter";
    case "stop":
      return "stop";
    default:
      return "other";
  }
}

/** True when a provider error is an AVAILABILITY failure worth a fallback/retry. */
function isAvailabilityError(error: unknown): boolean {
  if (APICallError.isInstance(error)) {
    if (error.isRetryable) return true;
    const status = error.statusCode;
    return status === 408 || status === 429 || (status ?? 0) >= 500;
  }
  // Aborts / network timeouts surface as generic errors — treat as transient.
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return (
    message.includes("timeout") ||
    message.includes("network") ||
    message.includes("aborted")
  );
}

export function createGatewayLanguageModel(): LanguageModel {
  // Explicit credential (see module note). Read at call time so a rotated
  // OIDC token is always current; falls back to ambient auto-detection only if
  // neither is present.
  const apiKey =
    process.env.AI_GATEWAY_API_KEY ?? process.env.VERCEL_OIDC_TOKEN;
  const gateway = createGateway(apiKey ? { apiKey } : {});

  return {
    async generate(
      request: LanguageModelRequest,
    ): Promise<LanguageModelResponse> {
      const start = Date.now();
      try {
        const result = await generateText({
          model: gateway(request.target),
          system: request.system,
          prompt: request.prompt,
          temperature: request.settings.temperature,
          topP: request.settings.topP,
          maxOutputTokens: request.settings.maxOutputTokens,
          abortSignal: request.signal,
          output: Output.object({
            name: request.schemaName,
            description: request.schemaDescription,
            schema: request.schema,
          }),
        });

        return {
          text: result.text,
          resolvedModelId: result.response.modelId ?? request.target,
          usage: mapUsage(result.usage),
          latencyMs: Date.now() - start,
          finishReason: mapFinishReason(result.finishReason),
        };
      } catch (error) {
        // The model produced output that the SDK could not parse/validate — this
        // is NOT an availability failure. Return the raw text so the application
        // pipeline can classify it and run the repair ladder.
        if (NoObjectGeneratedError.isInstance(error)) {
          return {
            text: error.text ?? "",
            resolvedModelId: error.response?.modelId ?? request.target,
            usage: mapUsage(error.usage),
            latencyMs: Date.now() - start,
            finishReason: mapFinishReason(error.finishReason),
          };
        }

        // TEMP DIAGNOSTIC (remove after): surface credential presence + raw
        // provider message to runtime logs to pinpoint the prod failure.
        console.error("[gw-diag]", {
          keySource: process.env.AI_GATEWAY_API_KEY
            ? "env-key"
            : process.env.VERCEL_OIDC_TOKEN
              ? "oidc"
              : "none",
          target: request.target,
          status:
            (error as { statusCode?: number })?.statusCode ??
            (error as { cause?: { statusCode?: number } })?.cause?.statusCode,
          name: (error as { name?: string })?.name,
          raw: (error instanceof Error ? error.message : String(error)).slice(
            0,
            300,
          ),
        });

        // Availability failures throw retryable so the pipeline tries fallbacks;
        // everything else is a non-retryable generation failure. Raw provider
        // messages stay in internalDetail — never surfaced to a client.
        const availability = isAvailabilityError(error);
        throw generationFailedError({
          safeMessage: availability
            ? "The service is busy. Please try again."
            : "We couldn't complete this. Please try again.",
          internalDetail:
            error instanceof Error ? error.message : String(error),
          retryable: availability,
          stage: "adapter.gateway-language-model",
          cause: error,
        });
      }
    },
  };
}
