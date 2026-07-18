import type {
  LanguageModel,
  LanguageModelRequest,
  LanguageModelResponse,
  ModelFinishReason,
} from "@/application/ports/language-model";
import type { TokenUsage } from "@/domain/generation-run";
import { generationFailedError } from "@/lib/errors";

/**
 * A first-class, SCRIPTABLE FAKE language model. There is no `AI_GATEWAY_API_KEY`
 * here and CI never makes paid calls, so EVERY test runs on this fake — it is the
 * primary way the validation pipeline and the repair ladder are exercised.
 *
 * It is deliberately dumb: it ignores the prompt and returns whatever the script
 * says, so a test can drive any outcome the pipeline must handle — a valid
 * fixture, malformed JSON, a truncation (`finishReason: "length"`), a content
 * filter (`finishReason: "content-filter"`), a schema-violating object, an
 * availability failure (`kind: "unavailable"` — throws a RETRYABLE error so the
 * pipeline exercises fallbacks), or a terminal provider rejection
 * (`kind: "provider-error"` — throws a NON-retryable error so the pipeline must
 * fail fast). A script may be a single response, a SEQUENCE (call N gets item N;
 * the last item repeats), or a function of the request + call index.
 */

export interface FakeTextResponse {
  kind: "text";
  text: string;
  finishReason?: ModelFinishReason;
  usage?: Partial<TokenUsage>;
  resolvedModelId?: string;
  latencyMs?: number;
}

export interface FakeUnavailableResponse {
  kind: "unavailable";
  message?: string;
}

/** A terminal, NON-retryable provider rejection (4xx / malformed / misconfig). */
export interface FakeProviderErrorResponse {
  kind: "provider-error";
  message?: string;
}

export type FakeModelResponse =
  FakeTextResponse | FakeUnavailableResponse | FakeProviderErrorResponse;

export type FakeScript =
  | FakeModelResponse
  | FakeModelResponse[]
  | ((request: LanguageModelRequest, callIndex: number) => FakeModelResponse);

const DEFAULT_USAGE: TokenUsage = {
  inputTokens: 100,
  outputTokens: 200,
  totalTokens: 300,
};

function resolveResponse(
  script: FakeScript,
  request: LanguageModelRequest,
  callIndex: number,
): FakeModelResponse {
  if (typeof script === "function") return script(request, callIndex);
  if (Array.isArray(script)) {
    // Clamp past the end to the last scripted response (it repeats).
    return script[Math.min(callIndex, script.length - 1)];
  }
  return script;
}

export function createFakeLanguageModel(script: FakeScript): LanguageModel {
  let callIndex = 0;
  return {
    async generate(
      request: LanguageModelRequest,
    ): Promise<LanguageModelResponse> {
      const response = resolveResponse(script, request, callIndex);
      callIndex += 1;

      if (response.kind === "unavailable") {
        // Availability failure → retryable, so the pipeline tries a fallback.
        throw generationFailedError({
          safeMessage: "The service is busy. Please try again.",
          internalDetail: response.message ?? "fake: unavailable",
          retryable: true,
          stage: "adapter.fake-language-model",
        });
      }

      if (response.kind === "provider-error") {
        // Terminal provider rejection → NON-retryable, so the pipeline must fail
        // fast: no fallback walk, no retry masking (mirrors the gateway adapter's
        // throw for a 4xx / malformed request or a missing gateway key).
        throw generationFailedError({
          safeMessage: "We couldn't complete this. Please try again.",
          internalDetail: response.message ?? "fake: provider rejected",
          retryable: false,
          stage: "adapter.fake-language-model",
        });
      }

      const usage: TokenUsage = {
        inputTokens: response.usage?.inputTokens ?? DEFAULT_USAGE.inputTokens,
        outputTokens:
          response.usage?.outputTokens ?? DEFAULT_USAGE.outputTokens,
        totalTokens: response.usage?.totalTokens ?? DEFAULT_USAGE.totalTokens,
      };

      return {
        text: response.text,
        resolvedModelId: response.resolvedModelId ?? `fake:${request.target}`,
        usage,
        latencyMs: response.latencyMs ?? 5,
        finishReason: response.finishReason ?? "stop",
      };
    },
  };
}
