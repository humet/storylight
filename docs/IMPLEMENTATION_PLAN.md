# Storylight Implementation Plan

## Purpose

This plan turns the documentation into buildable vertical slices. Complete each milestone with working tests before moving to the next.

## Milestone 1 — Repository foundation

Read:

- `docs/README.md`
- `docs/company/engineering-culture.md`
- `docs/04-frontend/app-architecture.md`
- `docs/06-engineering/coding-standards.md`
- `docs/06-engineering/testing.md`

Build:

- Next.js App Router project
- strict TypeScript
- Tailwind
- linting and formatting
- unit-test runner
- end-to-end test harness
- environment validation
- server-only module boundary
- application error types

Exit:

- CI passes
- one server-rendered authenticated shell exists
- one sample domain unit test exists

## Milestone 2 — Database and authentication boundary

Read:

- `docs/05-backend/database.md`
- `docs/05-backend/auth.md`
- `docs/decisions/ADR-005-postgres-and-drizzle.md`

Build:

- Postgres and Drizzle configuration
- initial migrations
- users, families, memberships
- actor resolution
- repository interfaces
- cross-family authorisation tests

Exit:

- a signed-in parent can access only their own family
- migrations run cleanly from empty database

## Milestone 3 — Character narrative profiles

Read:

- `docs/02-storytelling/character-system.md`
- `docs/01-product/mobile-first.md`
- `docs/04-frontend/mobile-ux.md`

Build:

- character tables and versioning
- narrative identity schema
- parent character editor
- fictionalisation policy
- relationship records
- profile approval

Exit:

- two active characters can be created and read from the server
- permanent changes create versions

## Milestone 4 — Visual character profiles

Read:

- `docs/03-ai/image-generation.md`
- `docs/05-backend/storage.md`
- `docs/decisions/ADR-003-reference-driven-characters.md`

Build:

- private asset storage adapter
- visual profile and reference records
- image-model port
- candidate-generation workflow
- parent approval UI
- approved-reference delivery

Exit:

- a parent can approve a fictional character reference set
- rejected candidates are inaccessible

## Milestone 5 — Workflow engine

Read:

- `docs/02-storytelling/story-engine.md`
- `docs/03-ai/orchestration.md`
- `docs/05-backend/background-jobs.md`
- `docs/decisions/ADR-002-deterministic-workflows.md`

Build:

- workflow tables
- state-machine library
- durable dispatcher port
- idempotency
- stage output persistence
- retries and safe errors
- progress polling

Exit:

- a synthetic multi-stage job survives interruption and resumes without duplicate work

## Milestone 6 — Structured AI adapters

Read:

- `docs/03-ai/structured-output.md`
- `docs/03-ai/prompts.md`
- `docs/03-ai/models.md`
- `docs/decisions/ADR-004-capability-based-model-routing.md`

Build:

- provider registry
- Storylight capability registry
- prompt registry
- versioned Zod wire schemas
- structured-generation adapter
- generation-run records
- fake model adapters

Exit:

- test model outputs flow through parse, normalise, domain validate, and persist
- provider SDK imports exist only in adapters

## Milestone 7 — One-off stories

Read:

- `docs/02-storytelling/one-off-stories.md`
- `docs/02-storytelling/safety-age-appropriateness.md`
- `docs/04-frontend/story-reader.md`

Build:

- Story DNA
- one-off plan
- draft
- review
- revision
- story publication
- mobile creation flow
- text reader

Exit:

- a parent can create and read an approved one-off story
- safety and failed-review fixtures pass

## Milestone 8 — Continuity and series

Read:

- `docs/02-storytelling/continuity.md`
- `docs/02-storytelling/story-series.md`
- `docs/02-storytelling/world-building.md`

Build:

- series bible
- chapter blueprints
- continuity snapshots
- pure change application
- next-chapter lock
- next-chapter workflow
- series library and progress

Exit:

- a five-chapter synthetic series completes without critical drift
- concurrent requests cannot duplicate a chapter

## Milestone 9 — Chapter illustrations

Read:

- `docs/03-ai/image-generation.md`
- `docs/04-frontend/story-reader.md`
- `docs/06-engineering/cost-management.md`

Build:

- illustration specs
- deterministic prompt builder
- reference selector
- image job state machine
- technical validation
- vision review
- targeted repair
- derivatives
- pending-image reader state

Exit:

- approved text remains readable while images process
- rejected images are never returned
- identity test thresholds pass on synthetic characters

## Milestone 10 — Evaluation and production hardening

Read:

- `docs/03-ai/evaluation.md`
- `docs/06-engineering/observability.md`
- `docs/06-engineering/deployment.md`

Build:

- evaluation runner
- fixture sets
- comparison reports
- operational dashboards
- capability probes
- cost budgets
- alerts
- deletion workflow
- canary route configuration

Exit:

- every active model route has an evaluation approval
- rollback is tested
- production-readiness checklist passes

## Definition of done for each milestone

- Code and migrations committed
- Unit and integration tests added
- Mobile behaviour checked
- Accessibility checked
- Error and retry behaviour tested
- Relevant documentation updated
- No unresolved architecture decision hidden in implementation code
