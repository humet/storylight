import type {
  ChapterImageModel,
  GeneratedSceneImage,
} from "@/application/ports/chapter-image-model";
import type { ImageSceneRequest } from "@/domain/image-request";
import { loadSharp } from "./load-sharp";

/**
 * Deterministic FAKE chapter image model (M9). Renders a calm placeholder SCENE as
 * a real PNG at the requested 2K dimensions — no network, no provider SDK, no paid
 * call — so CI, the dev server and Playwright exercise the full generate → validate
 * → review → derivatives → deliver pipeline offline. The real reference-capable
 * gateway adapter lands behind this same port (`docs/03-ai/image-generation.md`,
 * ADR-006).
 *
 * Determinism: identical request (seed + dimensions) → identical bytes, so a stage
 * resume reproduces the exact same original and checksum instead of a duplicate.
 * The bytes are a genuine PNG (magic bytes + correct dimensions) so technical
 * validation and sharp derivatives operate on real raster data.
 */

const MODEL_ID = "fake-scene@1";

/** Small stable hash (FNV-1a) → 24-bit colour. */
function colourFrom(
  seed: number,
  salt: string,
): {
  r: number;
  g: number;
  b: number;
} {
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
      const sharp = await loadSharp();
      // The FAKE renders at a capped long edge (the real adapter targets 2K). This
      // keeps the placeholder's aspect ratio exactly (technical validation checks
      // the RATIO, not the absolute size) while keeping local sharp encoding fast
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

      const mw = Math.round(width * 0.5);
      const mh = Math.round(height * 0.5);
      const medallionPng = await sharp({
        create: {
          width: mw,
          height: mh,
          channels: 4,
          background: { ...medallion, alpha: 1 },
        },
      })
        .png()
        .toBuffer();

      const buffer = await sharp({
        create: {
          width,
          height,
          channels: 4,
          background: { ...ground, alpha: 1 },
        },
      })
        .composite([{ input: medallionPng, gravity: "center" }])
        .png()
        .toBuffer();

      return {
        bytes: new Uint8Array(buffer),
        contentType: "image/png",
        width,
        height,
        model: MODEL_ID,
        seed: request.seed,
      };
    },
  };
}
