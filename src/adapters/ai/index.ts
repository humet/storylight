import "server-only";

import type {
  LanguageModel,
  LanguageModelRequest,
} from "@/application/ports/language-model";
import { getEnv } from "@/lib/env";
import { DomainError } from "@/lib/errors";
import { createGatewayLanguageModel } from "./gateway-language-model";

/**
 * Composition-root selection for the {@link LanguageModel} port (mirrors
 * `getDb()` / `getObjectStorage()` / `getImageModel()`):
 *  - `AI_GATEWAY_API_KEY` set → the real gateway adapter;
 *  - otherwise → an UNCONFIGURED model that composes fine but throws a clear,
 *    non-retryable error if actually invoked.
 *
 * The unconfigured fallback (rather than throwing at construction) matters: the
 * workflow runtime builds the language model eagerly while wiring the registry,
 * and must not fail to compose in dev/test/CI where no key exists. There is no
 * dev fake here — a fake that fabricates schema-valid output is meaningful only
 * per-schema, so TESTS inject `createFakeLanguageModel` directly; nothing invokes
 * a real model in dev/test/CI.
 */

function createUnconfiguredLanguageModel(): LanguageModel {
  return {
    async generate(_request: LanguageModelRequest) {
      void _request;
      throw new DomainError({
        code: "GENERATION_FAILED",
        safeMessage: "This feature isn't available right now.",
        internalDetail:
          "No AI_GATEWAY_API_KEY configured; the gateway language model is unavailable. Tests inject a fake language model directly.",
        retryable: false,
        stage: "adapter.language-model",
      });
    },
  };
}

export function getLanguageModel(): LanguageModel {
  const env = getEnv();
  if (env.AI_GATEWAY_API_KEY) return createGatewayLanguageModel();
  return createUnconfiguredLanguageModel();
}
