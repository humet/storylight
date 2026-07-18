import "server-only";

import type {
  LanguageModel,
  LanguageModelRequest,
} from "@/application/ports/language-model";
import { getEnv, isDevLikeEnv } from "@/lib/env";
import { DomainError } from "@/lib/errors";
import { createDevFixtureLanguageModel } from "./dev-fixture-language-model";
import { createGatewayLanguageModel } from "./gateway-language-model";

/**
 * Composition-root selection for the {@link LanguageModel} port (mirrors
 * `getDb()` / `getObjectStorage()` / `getImageModel()`):
 *  - `AI_GATEWAY_API_KEY` set → the real gateway adapter;
 *  - else dev/test-like → a context-aware DEV FIXTURE model so the running dev app
 *    (and the Playwright e2e) publishes a believable one-off story offline
 *    (mirrors the M4 dev fake image model);
 *  - otherwise (production without a key) → an UNCONFIGURED model that composes
 *    fine but throws a clear, non-retryable error if actually invoked.
 *
 * The composing (non-throwing at construction) fallback matters: the workflow
 * runtime builds the language model eagerly while wiring the registry, and must
 * not fail to compose where no key exists. UNIT/INTEGRATION tests never use these
 * — they inject `createFakeLanguageModel` directly with per-case scripts.
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
  // Dev/test-like without a key → the context-aware fixture model so the running
  // app publishes a believable story offline (tests inject their own fake).
  if (isDevLikeEnv(env)) return createDevFixtureLanguageModel();
  return createUnconfiguredLanguageModel();
}
