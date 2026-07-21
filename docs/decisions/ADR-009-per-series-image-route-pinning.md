# ADR-009: Per-Series Image-Route Pinning

**Status:** Accepted (2026-07-21)

## Context

Domain rule 8 (`AGENTS.md`) requires that "existing series pin prompt, schema,
model-route, and visual-profile versions", and `docs/03-ai/image-generation.md`
states "Existing series do not change automatically" and "Visual profiles are
immutable per series". Language routes already honour this: a series pins a
`PinnedRouteProfile` at creation and `model-registry` resolves the pinned version
regardless of what later becomes active (`ADR-004`).

The **image** GENERATION route did not. `image-route-registry.ts` was a single
source-controlled version (`IMAGE_ROUTE_VERSION`), and `generate-illustration-workflow`
resolved generation routes against it **globally**. When the routine tier was
swapped from `google/gemini-3.1-flash-image` to `bytedance/seedream-5.0-pro`
(image-route v1 → v2, BUILD_STATE 2026-07-21), the swap would apply to the **next
chapter of an existing, partially-illustrated series** — a rule-8 violation. It was
surfaced during that swap and accepted for rollout only with explicit owner sign-off
because the DB then held test series only; per-series image-route pinning was queued
as the follow-up. This ADR is that follow-up.

The series' pinned VISUAL PROFILE versions (which reference set a child is drawn
from) were already pinned (M8) and are unaffected here — this ADR pins the image
MODEL ROUTE.

## Decision

1. **Multi-version registry (source-controlled history).** `image-route-registry.ts`
   keeps every image-route version as an immutable record keyed by version id
   (v1 all-Gemini, v2 Seedream-routine), exactly like the illustration-plan wire
   schema keeps v1/v2/v3. `resolveGeneration(phase, pinnedVersion?)` resolves the
   generation tiers against the pinned version when given, else the active version
   (`ACTIVE_IMAGE_ROUTE_VERSION`). An **unknown pinned version is a loud, typed,
   non-retryable error** — never a silent fallback to active.

2. **Scope: GENERATION tiers only.** Only the routine / repair / premium generation
   tiers are pinned — they define the series' visual identity. The **vision-review
   route floats with the active version**: a review is a safety mechanism that
   compares the painted image against canonical facts, reviewing with a newer/better
   reader does not change the series' look, and review strictness should be
   upgradeable. No documentation conflict was found — `image-generation.md` pins the
   "image route version" for visual identity (generation) and treats review as a
   safety gate; floating the reviewer is consistent with that intent.

3. **Pin at creation.** A new series stamps the then-active image-route version into
   its pins (`series_bibles.pinned_image_route_version`), alongside the existing
   route / prompt / schema / visual-profile pins, stamped from the source-controlled
   `ACTIVE_IMAGE_ROUTE_VERSION` constant exactly as the schema/prompt pins are.

4. **Backfill.** Migration `0014` adds the column additively (nullable → backfill →
   `NOT NULL`) and backfills every existing series to the current active version
   (`mvp-image-routes-v2`). Existing series are disposable test data and v2 is
   exactly what they resolved before this change, so the backfill is observably a
   no-op; it simply makes the pin explicit.

5. **Workflow consumption.** `generate-illustration-workflow`'s prepare stage resolves
   the pinned version (series → `getPinnedImageRouteVersion`, loud error if absent;
   one-off → null ⇒ active) and threads it through the paint phases, which resolve
   generation routes against it. Publication provenance
   (`illustration_revisions.image_route_version`) now records the version the winning
   GENERATION route actually resolved from — previously it (harmlessly, while all
   tiers shared one version) recorded the review route's version.

## Consequences

- A future image-route swap applies to **new series and one-offs only**; existing
  series keep their pinned look for every remaining chapter (rule 8 honoured).
- Published illustration revisions remain immutable and carry honest generation-route
  provenance (rule 5).
- **Upgrading an existing series' image route** (e.g. moving a long-running series to
  a newer, better model) becomes an **explicit, parent-facing action** — out of scope
  here. Today the only way a series' route changes is a deliberate future feature; it
  never happens silently.
- The vision reviewer can be upgraded independently without touching any series pin.
