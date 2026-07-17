# Storylight

Storylight is a mobile-first application for creating personalised, illustrated bedtime stories. It supports complete one-off adventures and multi-night series with planned story arcs, persistent continuity, and stable illustrated characters.

This repository is designed around one central principle:

> Storylight should feel like a premium children’s publishing experience that happens to use AI behind the scenes.

The AI is not the product. Shared reading, consistent characters, memorable worlds, and a calm bedtime ritual are the product.

## Intended stack

- Next.js App Router
- React and TypeScript with strict type checking
- Tailwind CSS
- Vercel AI SDK behind Storylight-owned model adapters
- Postgres
- Drizzle ORM
- Object storage compatible with signed private delivery
- Durable background workflows for text and image generation

Provider choices must remain replaceable. Domain code must not import provider SDKs directly.

## Documentation map

### Product

- [`01-product/vision.md`](01-product/vision.md)
- [`01-product/product-principles.md`](01-product/product-principles.md)
- [`01-product/mobile-first.md`](01-product/mobile-first.md)
- [`01-product/user-journeys.md`](01-product/user-journeys.md)
- [`01-product/roadmap.md`](01-product/roadmap.md)

### Company and product character

- [`company/philosophy.md`](company/philosophy.md)
- [`company/writing-style.md`](company/writing-style.md)
- [`company/design-philosophy.md`](company/design-philosophy.md)
- [`company/engineering-culture.md`](company/engineering-culture.md)

### Storytelling domain

- [`02-storytelling/story-engine.md`](02-storytelling/story-engine.md)
- [`02-storytelling/character-system.md`](02-storytelling/character-system.md)
- [`02-storytelling/continuity.md`](02-storytelling/continuity.md)
- [`02-storytelling/story-series.md`](02-storytelling/story-series.md)
- [`02-storytelling/one-off-stories.md`](02-storytelling/one-off-stories.md)
- [`02-storytelling/world-building.md`](02-storytelling/world-building.md)
- [`02-storytelling/safety-age-appropriateness.md`](02-storytelling/safety-age-appropriateness.md)

### AI

- [`03-ai/orchestration.md`](03-ai/orchestration.md)
- [`03-ai/structured-output.md`](03-ai/structured-output.md)
- [`03-ai/prompts.md`](03-ai/prompts.md)
- [`03-ai/models.md`](03-ai/models.md)
- [`03-ai/image-generation.md`](03-ai/image-generation.md)
- [`03-ai/evaluation.md`](03-ai/evaluation.md)

### Frontend

- [`04-frontend/mobile-ux.md`](04-frontend/mobile-ux.md)
- [`04-frontend/story-reader.md`](04-frontend/story-reader.md)
- [`04-frontend/app-architecture.md`](04-frontend/app-architecture.md)
- [`04-frontend/design-system.md`](04-frontend/design-system.md)
- [`04-frontend/accessibility.md`](04-frontend/accessibility.md)

### Backend

- [`05-backend/database.md`](05-backend/database.md)
- [`05-backend/storage.md`](05-backend/storage.md)
- [`05-backend/auth.md`](05-backend/auth.md)
- [`05-backend/background-jobs.md`](05-backend/background-jobs.md)
- [`05-backend/api.md`](05-backend/api.md)

### Engineering

- [`06-engineering/coding-standards.md`](06-engineering/coding-standards.md)
- [`06-engineering/testing.md`](06-engineering/testing.md)
- [`06-engineering/observability.md`](06-engineering/observability.md)
- [`06-engineering/deployment.md`](06-engineering/deployment.md)
- [`06-engineering/cost-management.md`](06-engineering/cost-management.md)

### Architecture decisions

- [`decisions/ADR-001-mobile-first.md`](decisions/ADR-001-mobile-first.md)
- [`decisions/ADR-002-deterministic-workflows.md`](decisions/ADR-002-deterministic-workflows.md)
- [`decisions/ADR-003-reference-driven-characters.md`](decisions/ADR-003-reference-driven-characters.md)
- [`decisions/ADR-004-capability-based-model-routing.md`](decisions/ADR-004-capability-based-model-routing.md)
- [`decisions/ADR-005-postgres-and-drizzle.md`](decisions/ADR-005-postgres-and-drizzle.md)
- [`decisions/ADR-006-concrete-infrastructure.md`](decisions/ADR-006-concrete-infrastructure.md)

## Claude Code entry point

A repository-level `CLAUDE.md` is included alongside the `docs` folder. It contains the project invariants Claude Code should read automatically. Begin implementation with [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md).

## How Claude Code should use these documents

Claude Code should not be given the whole documentation set for every task. Point it to the smallest relevant subset.

Examples:

```text
Read:
- docs/README.md
- docs/01-product/product-principles.md
- docs/04-frontend/mobile-ux.md
- docs/04-frontend/story-reader.md

Implement the mobile story-reader shell.
```

```text
Read:
- docs/02-storytelling/continuity.md
- docs/03-ai/orchestration.md
- docs/03-ai/structured-output.md
- docs/05-backend/database.md

Implement continuity snapshots and the pure state-transition function.
```

## Non-negotiable rules

1. Story and series state belong in the database, not chat history.
2. Models never write directly to canonical state.
3. Published chapters and illustrations are immutable revisions.
4. Child-character appearance is reference-driven, not prompt-only.
5. Series are planned before Chapter 1 is written.
6. Mobile is the primary product surface.
7. Parents retain control over generation and regeneration.
8. AI-provider details remain behind adapters.
9. Every model output is schema-validated and domain-validated.
10. Safety, continuity, and identity failures are blocking.

## MVP completion definition

The MVP is complete when a parent can:

1. Create approved storybook characters for two children.
2. Enter a simple idea on a phone.
3. Generate a one-off story or a planned series.
4. Read an approved illustrated chapter in a calm mobile reader.
5. Continue a series on another evening without continuity drift.
6. Regenerate a chapter or image without breaking later story state.
7. Trust that rejected content is never shown.
