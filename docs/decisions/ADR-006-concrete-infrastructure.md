# ADR-006 — Concrete infrastructure selections

Status: Accepted (2026-07-17)

## Context

The documentation set deliberately keeps infrastructure behind Storylight-owned ports so vendors remain replaceable (`docs/README.md`, ADR-002, ADR-004, ADR-005). Implementation needs one concrete target per slot. Storylight is a personal project, so accounts are personal (GitHub, Vercel, Neon) — not organisation-owned.

Every choice below sits behind a port; changing a vendor later means changing an adapter, not domain code.

## Decisions

| Slot | Decision | Notes |
| --- | --- | --- |
| Hosting | Vercel | Personal account. |
| Postgres | Neon via Vercel Marketplace | Local dev: Neon branch or Docker Postgres. Drizzle ORM per ADR-005. |
| Object storage | Vercel Blob (private) | Behind the `ObjectStorage` port; server-side upload, short-lived signed delivery, key scheme from `docs/05-backend/storage.md`. |
| Durable workflows | Vercel Workflow (WDK, `workflow` package) | Behind the `JobDispatcher` port; durability requirements from `docs/05-backend/background-jobs.md`. |
| Authentication | Better Auth, sessions in Postgres | Behind the `AuthenticatedActor` boundary (`requireActor()`); HTTP-only cookies, CSRF, roles `owner/parent/viewer` per `docs/05-backend/auth.md`. |
| AI SDK | Vercel AI SDK v6 (`generateText` + `Output.object`) | Zod v4 wire schemas; provider imports only in `src/adapters/ai/`. |
| Model access | Vercel AI Gateway (single `AI_GATEWAY_API_KEY`) | Models addressed as gateway slugs (`anthropic/…`, `google/…`, `openai/…`). Storylight's capability registry (ADR-004) remains the routing brain: it pins gateway slugs per route version, records resolved model IDs per generation run, and owns availability-only fallback policy. Gateway-side automatic model fallback stays OFF so review and pinning rules cannot be bypassed. Gateway usage/cost reporting feeds `docs/06-engineering/cost-management.md`. |
| Text model routes (initial hypothesis; verify IDs at implementation) | Claude Sonnet tier for planning/writing; Claude Haiku tier for continuity extraction; Gemini (different family) for review per `docs/03-ai/models.md`. | All behind the capability registry, gated by evaluation before going active. |
| Image model routes | Gemini reference-capable image model for character references + routine illustration (image-input support is mandatory for ADR-003); OpenAI gpt-image tier for premium escalation; Gemini/Claude multimodal for vision review. | |
| Progress transport | Polling with backoff | Docs allow polling or SSE for MVP. |
| Unit/integration tests | Vitest | Integration against Testcontainers or a Neon branch DB. |
| E2E | Playwright | Mobile viewport default project + 320px project. |
| Agent verification | `@vercel/next-browser` | Used by build agents to verify UI milestones against the live dev server. |
| Component workshop | Storybook + `@storybook/addon-mcp` + a11y addon | Stories for every design-system component incl. Lamplight dark theme and 320px viewport; agents use the Storybook MCP server for real props and story tests. |
| Lint/format | ESLint + Prettier, GitHub Actions CI | ESLint boundary rule forbids provider SDK imports outside `src/adapters/**`. |
| UI | Custom Tailwind v4 components; Radix primitives only for Dialog/Sheet/Menu focus management; Lucide icons | Per `docs/04-frontend/design-system.md`. |
| Fonts | Literata (body/story), Fraunces (display), system stack (UI) | Via `next/font`; swappable tokens. |
| Runtime | pnpm, Node 22+, TypeScript strict | |

## Consequences

- One credential (`AI_GATEWAY_API_KEY`) covers all model providers; per-provider keys are not required.
- CI never makes paid provider calls — fake adapters implement every port for tests; paid evaluation is a separate manual gate (Milestone 10).
- Vendor swaps (e.g. Neon → RDS, Blob → S3, WDK → Trigger.dev) are adapter-level changes and require a follow-up ADR, not silent edits.

## Appendix — decisions delegated to implementation milestones

The docs name these but leave them unspecified; the implementing milestone defines them in code and logs the decision in `BUILD_STATE.md` (and here if architectural):

- Workflow state transition matrix (M5) — states are documented (`queued → running → waiting → completed → failed → cancelled`), adjacency is not.
- Story DNA schema (M7) — derive from `docs/02-storytelling/one-off-stories.md` plan requirements.
- Continuity sub-type schemas (M8) — `CharacterContinuityState`, `WorldContinuityState`, `PlotThreadContinuityState`, `ContinuityFact`, `VisualContinuityState`.
