import type {
  ChapterImageModel,
  GeneratedSceneImage,
} from "@/application/ports/chapter-image-model";
import type { ImageSceneRequest } from "@/domain/image-request";
import { encodePng, type Rgb } from "./png-encoder";

/**
 * Deterministic FAKE chapter image model (M9, ADR-007). Renders a calm placeholder
 * SCENE as a real PNG — no network, no provider SDK, no paid call, and crucially NO
 * image codec (no `sharp`, no WASM) — so CI, the dev server and Playwright exercise
 * the full generate → validate → review → deliver pipeline offline in the
 * serverless runtime. The bytes are produced by a tiny dependency-free PNG encoder
 * (`png-encoder.ts`): PNG signature + IHDR + a zlib "stored" (uncompressed) IDAT +
 * IEND, so no encode/resize ever runs (ADR-007). The real reference-capable gateway
 * adapter lands behind this same port (`docs/03-ai/image-generation.md`, ADR-006).
 *
 * Determinism: identical request (seed + dimensions) → identical bytes, so a stage
 * resume reproduces the exact same original and checksum instead of a duplicate.
 * The bytes are a genuine, decodable PNG (magic bytes + correct dimensions) so
 * technical validation (magic bytes + model-provided dimensions) and delivery
 * operate on real raster data.
 */

const MODEL_ID = "fake-scene@1";

/** Small stable hash (FNV-1a) → 24-bit colour. */
function colourFrom(seed: number, salt: string): Rgb {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < salt.length; i++) {
    h ^= salt.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return {
    r: 96 + (h & 0x7f),
    g: 96 + ((h >>> 8) & 0x7f),
    b: 96 + ((h >>> 16) & 0x7f),
  };
}

export function createFakeChapterImageModel(): ChapterImageModel {
  return {
    async generate(request: ImageSceneRequest): Promise<GeneratedSceneImage> {
      // The FAKE renders at a capped long edge (the real adapter targets 2K). This
      // keeps the placeholder's aspect ratio exactly (technical validation checks
      // the RATIO, not the absolute size) while keeping the pure-JS encoder fast
      // enough that background image jobs don't starve the single-process dev/e2e
      // harness. A real render would honour `request.dimensions` fully.
      const { width: reqW, height: reqH } = request.dimensions;
      const CAP = 1024;
      const scale = Math.min(1, CAP / Math.max(reqW, reqH));
      const width = Math.max(1, Math.round(reqW * scale));
      const height = Math.max(1, Math.round(reqH * scale));

      // A repair attempt shifts the palette so a resumed/repaired render differs
      // deterministically from the initial one (honest lineage under review).
      const salt = request.repairInstruction
        ? `${request.artBibleVersion}:repair`
        : request.artBibleVersion;
      const ground = colourFrom(request.seed, salt);
      const medallion = colourFrom(request.seed, `${salt}:medallion`);

      // A solid warm-ground field with a centered medallion rectangle (50% × 50%).
      const mw = Math.round(width * 0.5);
      const mh = Math.round(height * 0.5);
      const mx0 = Math.round((width - mw) / 2);
      const my0 = Math.round((height - mh) / 2);

      const bytes = encodePng({
        width,
        height,
        pixel: (x, y) => {
          const inMedallion =
            x >= mx0 && x < mx0 + mw && y >= my0 && y < my0 + mh;
          return inMedallion ? medallion : ground;
        },
      });

      return {
        bytes,
        contentType: "image/png",
        width,
        height,
        model: MODEL_ID,
        seed: request.seed,
      };
    },
  };
}
