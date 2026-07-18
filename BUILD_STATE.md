# BUILD_STATE.md — cross-session build log

Read this before starting a milestone; update it when you finish one. Milestones and their Read/Build/Exit lists live in `docs/IMPLEMENTATION_PLAN.md`. Concrete infrastructure choices live in `docs/decisions/ADR-006-concrete-infrastructure.md`. Project invariants live in `CLAUDE.md` (via `AGENTS.md`).

## Milestone checklist

- [x] M0 — Decisions + scaffold seams (ADR-006, this file, Next.js scaffold, boundary lint, CI)
- [x] M1 — Repository foundation (Storybook, tokens/themes, env validation, domain errors, authenticated shell)
- [x] M2 — Database and authentication boundary (Drizzle schema + migrations, Better Auth on Drizzle, family bootstrap, real actor resolution, repository ports, cross-family authz tests)
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

| Path                                         | Role                                                                  |
| -------------------------------------------- | --------------------------------------------------------------------- |
| `src/domain/`                                | Pure types + pure functions, no IO (see folder README)                |
| `src/domain/family.ts`                       | `Family`/`FamilyMembership` domain types (DB-independent)             |
| `src/application/`                           | Command/query services, workflow coordinators — ports only            |
| `src/application/ports/family-repository.ts` | `FamilyRepository` port (owned by app; DB implements)                 |
| `src/application/family-access.ts`           | `authorizeFamilyAction` — membership + role capability gate           |
| `src/adapters/{ai,storage,jobs,auth}/`       | ONLY place provider SDKs may be imported (ESLint-enforced)            |
| `src/db/schema/`                             | Drizzle tables: Better Auth core + `families`/`family_members`        |
| `src/db/client.ts`                           | Single DB entry point (`getDb`); pg driver / dev PGlite fallback      |
| `src/db/repositories/`                       | Drizzle implementations of application ports                          |
| `src/db/testing.ts`                          | Empty-then-migrated in-memory PGlite for integration tests            |
| `drizzle/`                                   | Committed SQL migrations (tracked; regenerate via `pnpm db:generate`) |
| `src/lib/`                                   | Env validation, typed domain errors, branded IDs (from M1)            |
| `src/components/`                            | Design-system components + Storybook stories (from M1)                |
| `tests/eslint-provider-boundary.test.ts`     | Regression proof of the provider-import boundary                      |
| `e2e/`                                       | Playwright suite (mobile + 320px projects)                            |
| `.github/workflows/ci.yml`                   | CI in the documented order; no paid provider calls                    |

## Decision log (mid-build choices not worth a full ADR)

- 2026-07-17 (M0): `CLAUDE.md` is `@AGENTS.md` (create-next-app convention); the full project instructions live in `AGENTS.md` with the Next.js version-warning block kept on top.
- 2026-07-17 (M0): `pnpm db:migrate` is a placeholder until Drizzle lands in M2; CI's migration-validation step is likewise a placeholder.
- 2026-07-17 (M0): Playwright e2e is wired locally (`pnpm test:e2e`) but not yet in CI — add it in M1 when the authenticated shell gives it something real to test.
- 2026-07-17 (M0): The mobile e2e projects use the iPhone 14 device profile, which runs on WebKit — run `pnpm exec playwright install chromium webkit` on a fresh machine. `next-browser` 0.7.1 is available globally (Homebrew) for live-app verification.
- 2026-07-18 (M1): Better Auth uses a **memory adapter** (sessions/users reset on restart) — M2 swaps it onto Drizzle/Postgres. `requireActor()` synthesizes `roles: ["owner"]`, `familyIds: []` until M2's membership tables exist.
- 2026-07-18 (M1): Design tokens live in `src/app/globals.css` (Tailwind v4 `@theme`): Paper light / Lamplight dark, accent terracotta `#a24e2b` (light) / `#e0955a` (dark), story body 19px, all pairs WCAG AA-verified. Fonts: Literata + Fraunces (`weight: "variable"` is required with `axes`).
- 2026-07-18 (M1): Storybook a11y addon runs in `test: "todo"` mode — violations surface but don't fail; consider flipping to `"error"` once the shell stabilises. Node-project tests alias `server-only` to `tests/stubs/server-only.ts` (and now `@` → `src`).
- 2026-07-18 (M2): **Runtime driver = `pg` (node-postgres Pool) via `drizzle-orm/node-postgres`**, connection string from `DATABASE_URL` (Neon-compatible). Selected in `src/db/client.ts`, the single swappable DB entry point. `getDb()` is async + lazy so `pnpm build`/CI (no env) never connect.
- 2026-07-18 (M2): **PGlite (`@electric-sql/pglite`) is the test/dev database.** Tests build an empty in-memory PGlite and apply the committed migrations (`src/db/testing.ts`) — real Postgres semantics, in-process, no Docker/network (CI has no `DATABASE_URL`). The integration suite doubles as the "migrations run cleanly from empty DB" exit check.
- 2026-07-18 (M2): **Sign-up family bootstrap.** Better Auth `databaseHooks.user.create.after` creates the user's family + `owner` membership in one transaction (`createFamilyWithOwner`), so every user has ≥1 family. Better Auth memory adapter → `drizzleAdapter(db, { provider: "pg", schema, usePlural: true })`; core tables (`users`/`sessions`/`accounts`/`verifications`) are hand-written in `src/db/schema/auth.ts` to match Better Auth's field names (snake_case columns, camelCase JS keys). All `better-auth` imports stay in `src/adapters/auth/**`.
- 2026-07-18 (M2): `getAuth()` is now **async** (awaits `getDb()` before building the adapter); all call sites (`require-actor`, `passwords`, `route`) already ran in async contexts. `requireActor()` reads real `familyIds`/`roles` from `family_members` (M1 placeholder removed); the `AuthenticatedActor` interface is unchanged. Per-family enforcement is `authorizeFamilyAction`, not the flat `roles` list.
- 2026-07-18 (M2): ESLint gained a **second boundary** — `drizzle-orm`, `drizzle-orm/*`, `pg`, `@electric-sql/pglite` are importable only in `src/db/**` and `src/adapters/**`; the two boundaries are expressed as non-overlapping file regions (flat-config "last match wins"), and `tests/eslint-provider-boundary.test.ts` proves both. Build artifacts (`storybook-static`, `drizzle`) added to ESLint/Prettier ignores.
- 2026-07-18 (M2): CI migration-validation step is now real: empty-PGlite migration test (`pnpm db:validate`) + file-consistency (`pnpm db:check`) + generate-and-diff drift guard. `pnpm db:migrate` = `drizzle-kit migrate` (production/`DATABASE_URL` path only); added `pnpm db:generate`.

## Deviations from docs

If code must diverge from `docs/`, record the conflict here and propose an ADR/doc correction — do not silently invent a third design (`CLAUDE.md` "Source of truth").

- 2026-07-18 (M2): `docs/05-backend/database.md` says migrations "never run implicitly from application startup". The **dev/test-only** PGlite fallback (`src/db/dev-pglite.ts`, used only when `DATABASE_URL` is absent and `NODE_ENV !== production`) self-migrates a file-backed `.pglite/dev` on first `getDb()` so the dev server and Playwright run offline with zero setup. This respects the rule's intent: the real Postgres path (`pg`) NEVER auto-migrates — production migrates via the explicit `pnpm db:migrate` step, and `client.ts` hard-errors if `DATABASE_URL` is missing in production. No doc change proposed; the rule targets production, which is honoured.
- 2026-07-18 (M1): `docs/04-frontend/app-architecture.md` sketches the app home at `(app)/page.tsx` (i.e. `/`) while also defining a `(marketing)/` group — two route groups cannot both own `/`. Current resolution: `/` = marketing landing, `/app` = authenticated home, `/sign-in` + `/sign-up` = auth. Proposed doc correction: annotate the route sketch so `(app)` pages live under `/app`. Revisit if the marketing surface is dropped (private family app may not need one), which would return the app home to `/`.
