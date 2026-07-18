# Production Readiness (M10)

Status of each `docs/06-engineering/deployment.md` "Production readiness" item, checked honestly. `✅ done` / `🟡 partial` / `N/A` / `⏳ deferred`.

## Checklist

| Item | Status | Notes |
| --- | --- | --- |
| **Backups tested** | 🟡 documented | Production Postgres is Neon (ADR-006), which provides managed continuous backups + point-in-time restore. No app code owns backups. A restore drill against a staging branch is an operational task to run before launch; documented here, not automatable in this repo. |
| **Deletion workflow tested** | ✅ done | `delete-family` registered workflow (revoke-access → purge-storage → purge-database), auditable/idempotent/resumable. Proven in `src/db/family-deletion.integration.test.ts`: every family-scoped content table empty, storage adapter received a delete for every key, membership revoked (reader/delivery authorisation fails → 404), audit trail complete, resumable after a mid-purge crash. Owner-only + reauthenticated (`requestFamilyDeletionAction`). |
| **Alerts configured** | ✅ predicates + probe | Pure `evaluateAlerts` predicates (`src/domain/alert-conditions.ts`, 8 conditions incl. sustained failures, safety, duplicate publication, high continuity rejection, image identity regression, cost budget breach, job backlog, capability-probe failure). Evaluated by the ops summary page and the `pnpm probe` check command. Wiring a fired alert to a pager/email is a deployment concern (see Deferred). |
| **Budgets configured** | ✅ done | Per-workflow `WorkflowBudget` enforced across TEXT (`generate-structured` repair ladder) AND IMAGE (`generate-illustration` paint loop cross-checks the phase ladder against `IMAGE_JOB_BUDGET`, ledger accrues per-image cost). Accepted-result cost report (`CostRepository.storyCost`) sums all attempts incl. retries/repair/escalation — proven a cheap-but-failing route cannot look artificially inexpensive (`src/db/cost-report.integration.test.ts`). |
| **Provider fallbacks evaluated** | 🟡 partial | Every route version carries availability-only `fallbacks`; the structured-generation pipeline walks them on a retryable (availability) failure and fails fast on a terminal rejection. The evaluation runner + `pnpm eval` gate route CHANGES; a dedicated fallback-availability evaluation is folded into the capability probe (`pnpm probe`, per-route liveness). Fallback RATE as a metric is not yet persisted queryably (event-stream signal). |
| **Evaluation approval recorded** | ✅ done | Every active route has a LIVE `evaluation_approvals` row (exit criterion, proven in `src/db/evaluation.integration.test.ts`). Seeded from a `local-fake` baseline (honest provenance) replacing M6's bootstrap approval. `RouteLifecycleService.activateRoute` ENFORCES the approval before a route can become the active baseline. Rollback + canary tested. |
| **Privacy review complete** | 🟡 documented | Observability events carry IDs + safe codes only — `buildEvent` drops forbidden keys (prose/prompt/profile/bytes/urls), unit-tested. Deletion removes/anonymises all private child data. Logs never contain story prose, raw prompts, child-profile details, signed URLs, image bytes, or provider traces (`observability.md` "Do not log"). A formal DPO sign-off is an operational step, not code. |
| **Env vars required in prod** | ✅ documented | See below. |
| **Migration step** | ✅ done | `pnpm db:migrate` applies committed `drizzle/` migrations (validated from empty in `pnpm db:validate`, checked in `pnpm db:check`). Run before/with deploy per compatibility; use expand-and-contract for breaking changes (`deployment.md`). |
| **Rollback story** | ✅ done | Model/prompt routes roll back by VERSION independent of app rollback: `RouteLifecycleService.rollbackTo` restores a prior approved route as the baseline and deprecates the incumbent WITHOUT touching series pins (M8 pinning keeps existing series on their pinned version) — proven in the evaluation integration test. Application rollback never requires undoing published content (published chapters/illustrations are immutable revisions). DB migrations require a planned rollback or forward-fix. |

## Required production environment variables

| Var | Purpose |
| --- | --- |
| `BETTER_AUTH_SECRET` | Session signing secret (Better Auth). Required outside dev/test. |
| `BETTER_AUTH_URL` | Canonical origin for CSRF trust (operator-declared; required outside dev/test). |
| `DATABASE_URL` | Postgres (Neon) connection string. |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob token for private object storage (the `ObjectStorage` adapter). |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway key. When ABSENT the language model composes but throws on use; `pnpm eval`/`pnpm probe` fall back to the fake path. Required for real generation in prod. |

`NODE_ENV` must be `production` in prod; it defaults to production when unset (a Railway/Docker deploy that forgets it fails loudly rather than booting the dev fallback insecurely — M1 decision).

## Deferred (documented, not built)

- **Series-chapter TEXT regeneration** — replacing an accepted chapter safely requires superseding an immutable continuity snapshot in the chain; needs its own design. The guard + refusal are wired (`regenerateSeriesChapter`); one-off text + illustration regeneration are fully live (M9).
- **Real-provider evaluation before real keys go live** — the seeded baseline + tests run on `local-fake`. Before enabling `AI_GATEWAY_API_KEY` in prod, run `pnpm eval` against the gateway, record `gateway`-provenance reports/approvals, and re-gate route activation. `pnpm probe` verifies each routed target responds.
- **Vendor observability / dashboards** — events are emitted as structured stdout lines (`storylight.event …`) via the console emitter; routing them to a vendor sink (and turning fired alert predicates into pager/email) is a deployment wiring concern, not built here. The internal ops summary at `/app/parent/ops` (owner-only) reads the named metrics from the DB directly.
- **Event-stream-derived metrics** — duplicate-publication ATTEMPTS and provider fallback RATE are event signals; they are emitted but not yet persisted to a queryable store, so the ops summary reports them as 0/`null` with a note.
