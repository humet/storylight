# Storylight

Storylight is a mobile-first application for creating personalised, illustrated bedtime stories with recurring characters, planned story arcs, and continuity across chapters.

The aim is for the technology to stay behind the reading experience: create an idea, build a story, keep characters recognisable, and return to the same world over multiple nights.

## Why I built this

Storylight started with bedtime stories for my kids.

I was using ChatGPT to create them, but I kept running into the same problems: characters would gradually change, illustrations would stop looking like the same people, details from earlier parts of the story would be forgotten, and it was difficult to continue a story naturally over several nights.

I wanted something where a character created tonight could still look, speak, and behave like themselves next week — and where an ongoing story could build on what had already happened rather than starting from a fresh prompt every time.

## Product flow

### 1. Start with an idea

<a href="docs/screenshots/IMG_1467.jpeg">
  <img src="docs/screenshots/IMG_1467.jpeg" width="620" alt="Storylight story idea creation screen" />
</a>

Storylight starts with a guided prompt that helps shape the story before generation begins.

### 2. Keep characters recognisable

<a href="docs/screenshots/IMG_1471.jpeg">
  <img src="docs/screenshots/IMG_1471.jpeg" width="620" alt="Storylight character reference paintings for Rosa" />
</a>

Recurring characters use approved reference artwork so later illustrations can preserve identity across scenes and stories.

### 3. Read the finished story

<a href="docs/screenshots/IMG_1472.jpeg">
  <img src="docs/screenshots/IMG_1472.jpeg" width="620" alt="Finished illustrated story in the Storylight reader" />
</a>

Published chapters are presented in a dedicated illustrated reader rather than a chat interface.

## Continuity model

Generating a single story or image is straightforward compared with keeping an illustrated series coherent over time. Storylight treats continuity and publication state as explicit application data.

- series are planned before Chapter 1 is generated
- canonical story state lives in Postgres rather than chat history
- model outputs are schema-validated and domain-validated before affecting state
- published chapters and illustrations are immutable revisions
- recurring characters use approved reference assets rather than prompt-only descriptions
- illustration generation can use those references to preserve character identity
- prompt, schema, model-route, and visual-profile versions can be pinned per series
- provider-specific SDKs are isolated behind application-owned adapters

## Generation pipeline

```text
Parent idea
    ↓
Structured story/series plan
    ↓
Validated canonical story state
    ↓
Chapter generation
    ↓
Character + scene specification
    ↓
Reference-conditioned image generation
    ↓
Vision review / repair
    ↓
Approved publication
```

Models can propose content, but application code owns validation and canonical state transitions.

## AI systems

Storylight uses separate model capabilities for text generation, image generation, and image review.

The repository includes support for:

- model routing through Vercel AI Gateway
- independent language, image-generation, and vision-review routes
- versioned prompts, schemas, model routes, and visual profiles
- model-route provenance on generated assets
- per-series route pinning for visual continuity
- structured output with defensive parsing and failure handling
- reference-image conditioning for recurring characters
- automated multimodal review and repair paths
- eval/probe tooling for testing model behaviour before changing routes
- cost bookkeeping and lower-cost model substitution where appropriate
- deterministic fake model adapters so CI/E2E does not depend on paid model calls

## Project invariants

Some important rules are kept explicit in the codebase and documentation:

- models never write directly to canonical state
- provider calls stay outside domain/frontend code
- existing series do not silently change model or visual-profile versions
- wrong child identity is a blocking image-review failure
- rejected content is never returned by reader APIs
- changes to canonical transitions require appropriate tests

See [`AGENTS.md`](AGENTS.md) and [`docs/README.md`](docs/README.md) for the detailed architecture and documentation map.

## Stack

- **Framework:** Next.js 16 App Router + React 19
- **Language:** TypeScript
- **AI:** Vercel AI SDK + AI Gateway
- **Workflows:** Vercel Workflow
- **Database:** Postgres + Drizzle ORM
- **Storage:** Vercel Blob / private object storage abstraction
- **Auth:** Better Auth
- **Validation:** Zod
- **Testing:** Vitest, Playwright, Storybook browser tests
- **UI:** Tailwind CSS

## Local development

### Requirements

- Node.js 22+
- pnpm
- Postgres
- a Vercel AI Gateway key for real model calls
- Vercel Blob credentials when using remote object storage

### Setup

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Environment variables are documented in [`.env.example`](.env.example). Local/test infrastructure can use the repository's development fallbacks where applicable.

### Quality checks

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm test:e2e
pnpm build
pnpm db:validate
pnpm db:check
```

## Documentation

Useful starting points:

- [`docs/01-product/vision.md`](docs/01-product/vision.md) — product intent
- [`docs/02-storytelling/continuity.md`](docs/02-storytelling/continuity.md) — canonical continuity model
- [`docs/03-ai/orchestration.md`](docs/03-ai/orchestration.md) — model orchestration
- [`docs/03-ai/image-generation.md`](docs/03-ai/image-generation.md) — illustration pipeline
- [`docs/03-ai/evaluation.md`](docs/03-ai/evaluation.md) — evaluation approach
- [`docs/decisions/`](docs/decisions/) — architecture decision records

## Status

Storylight is an actively developed personal project. Production family data, credentials, and private generated assets are not stored in the repository.
