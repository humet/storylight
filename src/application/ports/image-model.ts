import type { CharacterVisualDescriptor } from "@/domain/character-visual-descriptor";
import type { ReferenceView } from "@/domain/reference-view";

/**
 * Image-model PORT (`docs/03-ai/image-generation.md`, ADR-003/006). MODEL-NEUTRAL
 * by design: it takes a spec and returns image bytes + lineage metadata, so the
 * application service never knows whether the bytes came from the deterministic
 * FAKE adapter (M4) or the real reference-capable gateway model (M6/M9). Adapters
 * live in `src/adapters/images/**`; provider SDKs never leak past this boundary
 * (domain rule 12).
 *
 * The spec is deliberately not a prompt string — the adapter builds the concrete
 * provider prompt from the descriptor + view. This keeps prompt construction on
 * the adapter side of the boundary (ADR-003).
 */
export interface ImageGenerationSpec {
  /** Which canonical reference view to render. */
  view: ReferenceView;
  /** Model-neutral character descriptor (no prompt, no provider metadata). */
  descriptor: CharacterVisualDescriptor;
  /** Pinned Art Bible / style version this render targets. */
  artBibleVersion: string;
  /** Deterministic seed so a given candidate index reproduces exactly. */
  seed: number;
}

export interface GeneratedImage {
  view: ReferenceView;
  /** Raw image bytes — persisted to object storage, NEVER to Postgres. */
  bytes: Uint8Array;
  contentType: string;
  width: number;
  height: number;
  /** Opaque model identifier for lineage (e.g. "fake-placeholder@1"). */
  model: string;
  seed: number;
}

export interface ImageModel {
  /** Render a single reference view. */
  generate(spec: ImageGenerationSpec): Promise<GeneratedImage>;
}
