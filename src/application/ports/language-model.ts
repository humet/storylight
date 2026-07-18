import type { ZodType } from "zod";

import type { TokenUsage } from "@/domain/generation-run";
import type { GenerationSettings } from "@/domain/model-route";

/**
 * The LANGUAGE MODEL PORT (application-owned; adapters in `src/adapters/ai/**`).
 * MODEL-NEUTRAL: it takes a fully-built request (system + envelope prompt, the
 * wire schema, a resolved gateway slug, generation settings) and returns the RAW
 * model text plus lineage/usage metadata. Provider SDKs (`ai`, `Output.object`)
 * never leak past this boundary (domain rule 12).
 *
 * DESIGN: the port returns raw `text`, NOT a pre-parsed object. The validation
 * pipeline owns parse → wire-validate → normalise → domain-validate → the repair
 * ladder, so it can classify a failure (unparsable vs schema-violation vs
 * truncated) and choose the right rung. The real gateway adapter still passes the
 * schema to `Output.object` for provider-side structure, but the pipeline's own
 * validation of `text` is authoritative — which also makes the FAKE adapter
 * trivially scriptable (return a fixture string, malformed JSON, or a truncation).
 *
 * THROW CONTRACT: an adapter may reject with a {@link DomainError} whose
 * `retryable` flag classifies the failure, and the pipeline MUST honour it:
 *   - RETRYABLE throw = an AVAILABILITY failure (timeout / rate-limit / outage);
 *     the pipeline walks the route's fallbacks and, if all are exhausted, surfaces
 *     a retryable "unavailable" failure.
 *   - NON-RETRYABLE throw = a terminal provider rejection the adapter has already
 *     classified (a 4xx / malformed request from the gateway, or a missing
 *     `AI_GATEWAY_API_KEY`). It is NOT an availability failure: the pipeline must
 *     fail fast with that classification — no fallback walk, no retry masking.
 * A throw whose retryability is unknown is treated as retryable (availability).
 *
 * All NON-throwing outcomes (including a content filter or a truncation) are
 * returned as a response with the corresponding `finishReason` for the pipeline
 * to classify.
 */

/** Normalised finish reasons the pipeline reasons about. */
export type ModelFinishReason =
  | "stop"
  | "length" // truncated — the pipeline regenerates
  | "content-filter"
  | "other";

export interface LanguageModelRequest {
  /** Resolved gateway slug for THIS attempt (may be a fallback target). */
  target: string;
  system: string;
  prompt: string;
  /** The wire schema (adapter passes it to `Output.object`; pipeline validates). */
  schema: ZodType<unknown>;
  /** Output name/description passed to the provider as structural guidance. */
  schemaName: string;
  schemaDescription: string;
  settings: GenerationSettings;
  /** Optional cancellation (e.g. a workflow timeout). */
  signal?: AbortSignal;
}

export interface LanguageModelResponse {
  /** Raw model text — authoritative input to the pipeline's parser. */
  text: string;
  /** The provider model id the API actually resolved (`models.md`). */
  resolvedModelId: string;
  usage: TokenUsage;
  latencyMs: number;
  finishReason: ModelFinishReason;
}

export interface LanguageModel {
  /**
   * Generate once. Resolves with the raw response, or REJECTS with a
   * {@link DomainError}: retryable on an availability failure (the pipeline tries
   * a fallback), non-retryable on a terminal provider rejection (the pipeline
   * fails fast). See the THROW CONTRACT above.
   */
  generate(request: LanguageModelRequest): Promise<LanguageModelResponse>;
}
