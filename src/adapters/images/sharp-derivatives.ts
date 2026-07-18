import sharp from "sharp";

import type {
  DerivativeSource,
  DerivedImage,
  ImageDerivatives,
} from "@/application/ports/image-derivatives";

/**
 * sharp-backed {@link ImageDerivatives} adapter (M9). Produces responsive AVIF +
 * WebP variants at each requested width, aspect preserved, never enlarging beyond
 * the source (`docs/03-ai/image-generation.md` "Storage": responsive AVIF/WebP
 * derivatives; cost-management.md: derivatives instead of serving originals). The
 * ORIGINAL is preserved separately by the caller. The native `sharp` import stays
 * inside `src/adapters/**` (rule 12).
 */
export function createSharpDerivatives(): ImageDerivatives {
  return {
    async derive(
      source: DerivativeSource,
      widths: number[],
    ): Promise<DerivedImage[]> {
      const meta = await sharp(source.bytes).metadata();
      const sourceWidth = meta.width ?? Math.max(...widths);
      const results: DerivedImage[] = [];

      for (const width of widths) {
        const target = Math.min(width, sourceWidth);
        const base = sharp(source.bytes).resize({
          width: target,
          withoutEnlargement: true,
          fit: "inside",
        });

        // `effort: 2` trades a little compression for much faster encoding, which
        // keeps background image jobs from starving the single-process dev harness.
        const avif = await base
          .clone()
          .avif({ quality: 55, effort: 2 })
          .toBuffer({
            resolveWithObject: true,
          });
        results.push({
          format: "avif",
          contentType: "image/avif",
          width: avif.info.width,
          height: avif.info.height,
          bytes: new Uint8Array(avif.data),
        });

        const webp = await base.clone().webp({ quality: 72 }).toBuffer({
          resolveWithObject: true,
        });
        results.push({
          format: "webp",
          contentType: "image/webp",
          width: webp.info.width,
          height: webp.info.height,
          bytes: new Uint8Array(webp.data),
        });
      }
      return results;
    },
  };
}
