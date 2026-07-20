import type { default as Sharp } from "sharp";

/**
 * Lazy `sharp` loader. `sharp` is a native module (libvips) — importing it at
 * module-eval time would pull its binary into EVERY server bundle that
 * transitively wires the image adapters (the services composition root is
 * reachable from ordinary page renders like `/app`), and a serverless runtime
 * that can't dlopen the binary then 500s the whole page. Deferring the import to
 * first actual use keeps sharp off every page-render path: only the background
 * illustration job ever loads it, honouring text-first publication — a page
 * never fails because image rasterisation is unavailable.
 *
 * The native import stays inside `src/adapters/**` (rule 12).
 */
let sharpPromise: Promise<typeof Sharp> | undefined;

export function loadSharp(): Promise<typeof Sharp> {
  sharpPromise ??= import("sharp").then((m) => m.default);
  return sharpPromise;
}
