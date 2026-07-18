# BUILD_STATE.md — cross-session build log

Read this before starting a milestone; update it when you finish one. Milestones and their Read/Build/Exit lists live in `docs/IMPLEMENTATION_PLAN.md`. Concrete infrastructure choices live in `docs/decisions/ADR-006-concrete-infrastructure.md`. Project invariants live in `CLAUDE.md` (via `AGENTS.md`).

## Milestone checklist

- [x] M0 — Decisions + scaffold seams (ADR-006, this file, Next.js scaffold, boundary lint, CI)
- [x] M1 — Repository foundation (Storybook, tokens/themes, env validation, domain errors, authenticated shell)
- [x] M2 — Database and authentication boundary (Drizzle schema + migrations, Better Auth on Drizzle, family bootstrap, real actor resolution, repository ports, cross-family authz tests)
- [x] M3 — Character narrative profiles (character tables + versioning, narrative identity schema, mobile parent editor, fictionalisation policy, relationships, profile approval)
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

| Path                                                      | Role                                                                                     |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `src/domain/`                                             | Pure types + pure functions, no IO (see folder README)                                   |
| `src/domain/family.ts`                                    | `Family`/`FamilyMembership` domain types (DB-independent)                                |
| `src/domain/character.ts`                                 | Character narrative-identity domain types (exact `character-system.md`)                  |
| `src/domain/character-status.ts`                          | Pure lifecycle transition (draft→active→retired); throws on illegal                      |
| `src/domain/character-key.ts`                             | Pure slug + app-generated semantic key composition                                       |
| `src/application/`                                        | Command/query services, workflow coordinators — ports only                               |
| `src/application/ports/family-repository.ts`              | `FamilyRepository` port (owned by app; DB implements)                                    |
| `src/application/ports/character-repository.ts`           | `CharacterRepository` port (family-scoped reads/writes + versioning)                     |
| `src/application/character-{commands,queries,schemas}.ts` | Character command/query services + Zod v4 command schemas                                |
| `src/application/family-access.ts`                        | `authorizeFamilyAction` — membership + role capability gate                              |
| `src/adapters/{ai,storage,jobs,auth}/`                    | ONLY place provider SDKs may be imported (ESLint-enforced)                               |
| `src/db/schema/`                                          | Drizzle tables: Better Auth core + `families`/`family_members` + character tables        |
| `src/db/schema/characters.ts`                             | `child_characters` / `character_profile_versions` / `character_relationships`            |
| `src/db/repositories/character-repository.ts`             | Drizzle impl of `CharacterRepository` (family-scoped, versioned)                         |
| `src/components/` (M3 adds)                               | `CharacterCard`, `TextArea`, `SegmentedChoice`, `ToggleField`, `StatusBadge` (+ stories) |
| `src/app/(app)/app/characters/`                           | Mobile parent character editor (list, create/edit wizard, review+approve)                |
| `src/db/client.ts`                                        | Single DB entry point (`getDb`); pg driver / dev PGlite fallback                         |
| `src/db/repositories/`                                    | Drizzle implementations of application ports                                             |
| `src/db/testing.ts`                                       | Empty-then-migrated in-memory PGlite for integration tests                               |
| `drizzle/`                                                | Committed SQL migrations (tracked; regenerate via `pnpm db:generate`)                    |
| `src/lib/`                                                | Env validation, typed domain errors, branded IDs (from M1)                               |
| `src/components/`                                         | Design-system components + Storybook stories (from M1)                                   |
| `tests/eslint-provider-boundary.test.ts`                  | Regression proof of the provider-import boundary                                         |
| `e2e/`                                                    | Playwright suite (mobile + 320px projects)                                               |
| `.github/workflows/ci.yml`                                | CI in the documented order; no paid provider calls                                       |

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
- 2026-07-18 (M3): **Character versioning model.** `child_characters` holds identity (`character_key`), lifecycle (`status`, `approved_at`) and a pointer to the current version (`current_version` int + `current_version_id` FK); `character_profile_versions` holds immutable snapshots of the editable payload (displayName, apparentAge, pronouns, `narrative_identity` JSONB, `fictionalisation_policy` JSONB). A PERMANENT change (`updateCharacterProfile`) appends a new version and repoints the character; lifecycle changes (approve/retire) never mint a version. `UNIQUE(family_id, character_key)` and `UNIQUE(character_id, version)` enforced by the DB. Frequently-queried fields (status, current_version, display_name) are typed columns for cheap list queries. The character↔version FK is circular, resolved with a nullable `current_version_id` (set-null on delete) written in a second statement inside the create transaction.
- 2026-07-18 (M3): **Character keys are app-generated semantic slugs** (`buildCharacterKey` = `slugifyName(displayName)` + an 8-char crypto suffix), never a model/user id (AGENTS.md). DB IDs stay `defaultRandom()` UUIDs. Slug is a pure domain function; the random suffix is composed in the command layer.
- 2026-07-18 (M3): **Command/query layering.** `createCharacterCommands`/`createCharacterQueries` are dependency-injected factories over the `FamilyRepository` + `CharacterRepository` ports. Every mutation/read resolves the actor's PRIMARY family (`actor.familyIds[0]` — MVP is single-family), authorises with `authorizeFamilyAction` (capability `character:manage`), parses input with a Zod v4 schema, then calls the family-scoped repo. Membership is verified in the app layer; the repo additionally filters every query by `family_id`, so a guessed character id from another family is invisible (cross-family read/write proven by integration tests). Composition root: server-only `src/app/(app)/app/characters/service.ts` (builds repos from `getDb()`, mirroring `require-actor.ts`).
- 2026-07-18 (M3): **Mobile editor.** Progressive short-step wizard (`CharacterEditor`, one Client Component holding the draft; steps: basics → personality → speech → boundaries → review) submits a typed payload through thin Server Actions; approval is a separate `<form>` action on the character's own review surface (draft→active). New design-system primitives (`CharacterCard`, `TextArea`, `SegmentedChoice`, `ToggleField`, `StatusBadge`) added with light/Lamplight/320px stories. `Button` gained an exported `buttonClassName()` so navigational CTAs are styled `<Link>` anchors instead of `<button>`-in-`<a>` (invalid interactive nesting). Copy follows the warm house voice ("Who appears in your stories", status "Ready"/"Resting").
- 2026-07-18 (M1+M2 review checkpoint): adversarial review confirmed the boundary architecture and cross-family tests are sound; four findings fixed the same day: (1) sign-up family bootstrap is best-effort (runs after the user row commits) — the invariant "every user has ≥1 family" is now guaranteed by idempotent, per-user-serialized reconciliation in `requireActor()` (`FamilyRepository.ensureFamilyForUser`, FOR UPDATE lock, concurrency-tested); the hook now swallows+logs instead of failing sign-up with "email taken". (2) `NODE_ENV` defaults to **production** when unset — the dev fallback secret and dev PGlite require an explicit `development`/`test` value (`isDevLikeEnv`), so a Railway/Docker deploy that forgets `NODE_ENV` fails loudly instead of booting insecurely. (3) `BETTER_AUTH_URL` is required outside dev/test (CSRF origin trust must be operator-declared, not header-inferred). (4) `actorCan`/`AuthenticatedActor.roles` carry explicit "not family-scoped" warnings — per-family decisions go through `authorizeFamilyAction`. Deferred with a note: deleting an owner user cascades their membership away and can orphan a family without owners — handle in the M10 deletion workflow.

- 2026-07-18 (M3 verify): one-off e2e failure observed immediately after a build wiped dev state (11/12), not reproducible across 4 subsequent runs including from a fresh `.pglite`. Suspected first-boot migration race between parallel Playwright workers on the dev PGlite. Watch item: if it recurs, serialize first-boot migration or give e2e a dedicated pre-migrated database.

## Deviations from docs

If code must diverge from `docs/`, record the conflict here and propose an ADR/doc correction — do not silently invent a third design (`CLAUDE.md` "Source of truth").

- 2026-07-18 (M3): `docs/02-storytelling/character-system.md` types `CharacterProfile.visualProfileId: string` (required). Visual profiles are M4, so no visual profile exists to reference at character-creation time in M3. Resolution: the domain type and the DB column are nullable (`visualProfileId: string | null`, `visual_profile_id text` with no FK yet) and always `null` on create/edit in M3; M4 will populate it and can add the FK. Proposed doc correction: annotate the interface field as nullable-until-visual-profile-approved. No third design invented.
- 2026-07-18 (M2): `docs/05-backend/database.md` says migrations "never run implicitly from application startup". The **dev/test-only** PGlite fallback (`src/db/dev-pglite.ts`, used only when `DATABASE_URL` is absent and `NODE_ENV !== production`) self-migrates a file-backed `.pglite/dev` on first `getDb()` so the dev server and Playwright run offline with zero setup. This respects the rule's intent: the real Postgres path (`pg`) NEVER auto-migrates — production migrates via the explicit `pnpm db:migrate` step, and `client.ts` hard-errors if `DATABASE_URL` is missing in production. No doc change proposed; the rule targets production, which is honoured.
- 2026-07-18 (M1): `docs/04-frontend/app-architecture.md` sketches the app home at `(app)/page.tsx` (i.e. `/`) while also defining a `(marketing)/` group — two route groups cannot both own `/`. Current resolution: `/` = marketing landing, `/app` = authenticated home, `/sign-in` + `/sign-up` = auth. Proposed doc correction: annotate the route sketch so `(app)` pages live under `/app`. Revisit if the marketing surface is dropped (private family app may not need one), which would return the app home to `/`.
