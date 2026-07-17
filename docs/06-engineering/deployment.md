# Deployment

## Environments

- local
- preview
- staging/evaluation
- production

Evaluation traffic should not compete with production generation.

## CI pipeline

1. Install
2. Type check
3. Lint
4. Unit tests
5. Integration tests with fakes
6. Build
7. Migration validation
8. Security and dependency checks
9. Deploy preview

Paid model evaluations are separate release gates.

## Database migrations

Run controlled migrations before or during deployment according to compatibility.

Use expand-and-contract for breaking changes:

1. Add compatible schema.
2. Deploy code that writes both where required.
3. Backfill.
4. Switch reads.
5. Remove old fields later.

## Feature flags

Use flags for:

- new model route
- prompt experiment
- image escalation
- new reader mode
- background pre-generation

Flags must be stable per series where consistency matters.

## Rollback

Application rollback must not require undoing published content.

Model and prompt routes roll back by version.

Database migrations require a planned rollback or forward-fix strategy.

## Secrets

Keep provider keys server-side and environment scoped.

## Health checks

- application health
- database
- job queue
- storage
- lightweight model capability probes

## Production readiness

- backups tested
- deletion workflow tested
- alerts configured
- budgets configured
- provider fallbacks evaluated
- evaluation approval recorded
- privacy review complete

## Acceptance criteria

- A failed deployment does not corrupt workflows.
- Existing series continue using pinned profiles.
- Route rollback is independent of app rollback.
