import type {
  GeneratedImage,
  ImageGenerationSpec,
  ImageModel,
} from "@/application/ports/image-model";
import {
  REFERENCE_VIEW_LABELS,
  type ReferenceView,
} from "@/domain/reference-view";

/**
 * Deterministic FAKE image model (M4). It renders labelled placeholder images
 * LOCALLY as SVG bytes — no network, no provider SDK, no paid call — so CI and
 * the dev server exercise the full candidate → approve → deliver pipeline
 * offline. The real reference-capable gateway adapter lands in M6/M9 behind this
 * same port (`docs/03-ai/image-generation.md`, ADR-006).
 *
 * Determinism: identical spec → identical bytes. Colours and label come purely
 * from the descriptor + view + seed, so tests can assert stable checksums and a
 * parent re-requesting produces reproducible previews.
 */

const MODEL_ID = "fake-placeholder@1";

/** Aspect-appropriate canvas per view (mobile-clear framing). */
const VIEW_SIZE: Record<ReferenceView, { width: number; height: number }> = {
  "front-portrait": { width: 768, height: 1024 },
  "three-quarter": { width: 768, height: 1024 },
  "full-body-front": { width: 768, height: 1152 },
  "side-view": { width: 768, height: 1152 },
  expression: { width: 1024, height: 768 },
  "default-outfit": { width: 768, height: 1024 },
};

/** A small, stable string hash (FNV-1a) for deterministic colour selection. */
function hash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Escape text for safe inclusion in SVG/XML (the label is a display name). */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function renderSvg(spec: ImageGenerationSpec): {
  svg: string;
  width: number;
  height: number;
} {
  const { width, height } = VIEW_SIZE[spec.view];
  const seedKey = `${spec.descriptor.characterKey}:${spec.view}:${spec.seed}:${spec.artBibleVersion}`;
  const hue = hash(seedKey) % 360;
  const accentHue = (hue + 40) % 360;
  const name = escapeXml(spec.descriptor.displayName || "Character");
  const viewLabel = escapeXml(REFERENCE_VIEW_LABELS[spec.view]);
  const initial = escapeXml(
    (spec.descriptor.displayName.trim()[0] ?? "?").toUpperCase(),
  );

  // A calm gouache-ish placeholder: soft gradient ground, a portrait medallion,
  // and clear labels. No photorealism, no external assets — self-contained bytes.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${name} — ${viewLabel} reference placeholder">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="hsl(${hue} 55% 88%)"/>
      <stop offset="1" stop-color="hsl(${accentHue} 50% 74%)"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <circle cx="${width / 2}" cy="${height * 0.42}" r="${Math.min(width, height) * 0.26}" fill="hsl(${hue} 45% 96%)" stroke="hsl(${accentHue} 45% 42%)" stroke-width="6"/>
  <text x="${width / 2}" y="${height * 0.42}" text-anchor="middle" dominant-baseline="central" font-family="Georgia, serif" font-size="${Math.min(width, height) * 0.28}" fill="hsl(${accentHue} 45% 34%)">${initial}</text>
  <text x="${width / 2}" y="${height * 0.82}" text-anchor="middle" font-family="Georgia, serif" font-size="52" fill="hsl(${accentHue} 45% 26%)">${name}</text>
  <text x="${width / 2}" y="${height * 0.88}" text-anchor="middle" font-family="Georgia, serif" font-size="34" fill="hsl(${accentHue} 30% 34%)">${viewLabel}</text>
</svg>`;
  return { svg, width, height };
}

export function createFakeImageModel(): ImageModel {
  return {
    async generate(spec: ImageGenerationSpec): Promise<GeneratedImage> {
      const { svg, width, height } = renderSvg(spec);
      return {
        view: spec.view,
        bytes: new TextEncoder().encode(svg),
        contentType: "image/svg+xml",
        width,
        height,
        model: MODEL_ID,
        seed: spec.seed,
      };
    },
  };
}
