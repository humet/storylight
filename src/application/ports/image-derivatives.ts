/**
 * IMAGE DERIVATIVES port (`docs/03-ai/image-generation.md` "Storage": create
 * responsive AVIF/WebP derivatives; `docs/06-engineering/cost-management.md`:
 * derivatives instead of serving originals). The adapter (sharp) lives in
 * `src/adapters/images/**`; provider/native SDKs never leak past this boundary.
 * The ORIGINAL is preserved separately — this only produces the responsive
 * variants.
 */

export interface DerivativeSource {
  bytes: Uint8Array;
  contentType: string;
}

export interface DerivedImage {
  format: "avif" | "webp";
  contentType: string;
  width: number;
  height: number;
  bytes: Uint8Array;
}

export interface ImageDerivatives {
  /** Produce AVIF + WebP variants at each requested width (aspect preserved). */
  derive(source: DerivativeSource, widths: number[]): Promise<DerivedImage[]>;
}
