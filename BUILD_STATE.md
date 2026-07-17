# BUILD_STATE.md — cross-session build log

Read this before starting a milestone; update it when you finish one. Milestones and their Read/Build/Exit lists live in `docs/IMPLEMENTATION_PLAN.md`. Concrete infrastructure choices live in `docs/decisions/ADR-006-concrete-infrastructure.md`. Project invariants live in `CLAUDE.md` (via `AGENTS.md`).

## Milestone checklist

- [x] M0 — Decisions + scaffold seams (ADR-006, this file, Next.js scaffold, boundary lint, CI)
- [ ] M1 — Repository foundation (Storybook, tokens/themes, env validation, domain errors, authenticated shell)
- [ ] M2 — Database and authentication boundary
- [ ] M3 — Character narrative profiles
- [ ] M4 — Visual character profiles
- [ ] M5 — Workflow engine
- [ ] M6 — Structured AI adapters
- [ ] M7 — One-off stories
- [ ] M8 — Continuity and series
- [ ] M9 — Chapter illustrations
- [ ] M10 — Evaluation and production hardening

## How to verify a milestone

1. `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm build` — all green.
2. The milestone's Exit bullets in `docs/IMPLEMENTATION_PLAN.md` demonstrated by a test or runnable check.
3. UI milestones: verify components in Storybook (story tests + a11y addon via the MCP server at `http://localhost:6006/mcp`) AND drive the live app with `next-browser` against `pnpm dev` — mobile viewport, no dev-overlay errors, accessibility snapshot sane.
4. Update this file (checklist, file map, decision log), then commit.

## File map (key seams — update as they gain real code)

| Path                                     | Role                                                       |
| ---------------------------------------- | ---------------------------------------------------------- |
| `src/domain/`                            | Pure types + pure functions, no IO (see folder README)     |
| `src/application/`                       | Command/query services, workflow coordinators — ports only |
| `src/adapters/{ai,storage,jobs,auth}/`   | ONLY place provider SDKs may be imported (ESLint-enforced) |
| `src/db/`                                | Drizzle schema, migrations, repositories (from M2)         |
| `src/lib/`                               | Env validation, typed domain errors, branded IDs (from M1) |
| `src/components/`                        | Design-system components + Storybook stories (from M1)     |
| `tests/eslint-provider-boundary.test.ts` | Regression proof of the provider-import boundary           |
| `e2e/`                                   | Playwright suite (mobile + 320px projects)                 |
| `.github/workflows/ci.yml`               | CI in the documented order; no paid provider calls         |

## Decision log (mid-build choices not worth a full ADR)

- 2026-07-17 (M0): `CLAUDE.md` is `@AGENTS.md` (create-next-app convention); the full project instructions live in `AGENTS.md` with the Next.js version-warning block kept on top.
- 2026-07-17 (M0): `pnpm db:migrate` is a placeholder until Drizzle lands in M2; CI's migration-validation step is likewise a placeholder.
- 2026-07-17 (M0): Playwright e2e is wired locally (`pnpm test:e2e`) but not yet in CI — add it in M1 when the authenticated shell gives it something real to test.
- 2026-07-17 (M0): The mobile e2e projects use the iPhone 14 device profile, which runs on WebKit — run `pnpm exec playwright install chromium webkit` on a fresh machine. `next-browser` 0.7.1 is available globally (Homebrew) for live-app verification.

## Deviations from docs

None yet. If code must diverge from `docs/`, record the conflict here and propose an ADR/doc correction — do not silently invent a third design (`CLAUDE.md` "Source of truth").
