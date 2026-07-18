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
 * AVAILABILITY failures (timeout / rate-limit / outage) are thrown as a RETRYABLE
 * domain error so the pipeline can try the route's fallbacks. All other outcomes
 * (including a content filter or a truncation) are returned as a response with the
 * corresponding `finishReason`.
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
   * Generate once. Resolves with the raw response, or REJECTS with a retryable
   * domain error on an availability failure (so the pipeline tries a fallback).
   */
  generate(request: LanguageModelRequest): Promise<LanguageModelResponse>;
}
