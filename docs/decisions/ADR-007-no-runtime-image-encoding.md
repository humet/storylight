# ADR-007 — No image encoding in the serverless runtime

Status: Accepted (2026-07-20)

## Context

M9 (`docs/03-ai/image-generation.md`, `docs/05-backend/storage.md`) specifies generating and storing responsive **AVIF/WebP derivatives** of each approved illustration, implemented with `sharp`. On Vercel (Next 16 / Turbopack) this does not work: the serverless file tracer does not bundle `sharp`'s native `libvips` shared object into function bundles, so every image job failed with `ERR_DLOPEN_FAILED: libvips-cpp.so … cannot open shared object`. This was verified directly via a probe route in *both* a normal function and the Workflow `/step` function. Multiple remedies (serverExternalPackages, onlyBuiltDependencies, cross-arch install, lazy import, `node-linker=hoisted`, `outputFileTracingIncludes`) did not get the binary into the bundle; the last even broke serverless packaging (pnpm symlinks). A WASM alternative (`@jsquash`) failed the same way — its `.wasm` asset isn't fetchable from the bundled function (`fetch failed`).

The common cause is architectural: **running an image codec (native or WASM) inside our serverless runtime fights the platform's bundling/asset tracing.** Continuing to patch tracing config is a workaround treadmill.

## Decision

Storylight does **not** encode or resize images in its own serverless runtime.

- The **approved original** image bytes (from the image model) are stored privately in Blob and delivered through the existing authorized delivery route (unchanged: family-scoped, approved-only, `no-store`).
- We do **not** pre-generate stored AVIF/WebP derivatives. The illustration pipeline's "derivatives" step is removed; the reader is served the approved original.
- Responsive/optimized delivery (on-demand format + width negotiation) is deferred to a later enhancement using **Vercel Image Optimization** in front of the authorized original (needs a signed/tokenised source URL so the optimizer can fetch a private asset — out of scope here).
- No `sharp`, no WASM codec, and no native binaries in the runtime. The dev/test **fake** chapter image model produces a valid PNG with a tiny dependency-free encoder (solid-colour placeholder) — no codec needed.

## Consequences

- The documented "store AVIF/WebP derivatives" design (image-generation.md "Storage", storage.md "Derivatives") is superseded by this ADR for the delivery path. Those docs should be annotated to point here.
- Removed: `sharp`, `@jsquash/*`, `.npmrc` `node-linker=hoisted`, `sharp` from `serverExternalPackages`, the `onlyBuiltDependencies`/`supportedArchitectures` entries that existed only for sharp.
- Originals are larger than derivatives would be; acceptable for MVP. Revisit with Vercel Image Optimization if bandwidth/perf warrants (its own ADR).
- The image job state machine, reference selection, prompt builder, vision review, immutability, and authorized approved-only delivery are all unchanged — only the encode/derivative step is dropped.
