# Testing Strategy

## Pyramid

### Unit tests

- domain validators
- continuity transitions
- workflow state transitions
- review thresholds
- cost budgets
- reference selection
- chapter number selection

### Contract tests

- Zod wire schemas
- provider adapters
- storage adapter
- job adapter
- auth boundary

### Integration tests

- one-off workflow
- series creation
- next chapter
- revision
- continuity rejection
- image pending
- workflow resume
- duplicate request
- concurrent chapter request

### End-to-end tests

Mobile flows:

- create character
- create one-off
- start series
- continue series
- read chapter
- regenerate image
- recover from failed workflow

Use provider fakes for normal CI.

### Paid provider tests

Run outside pull-request CI:

- prompt and model evaluation
- structured-output smoke tests
- image reference tests
- capability probes

## Fixtures

Use invented children and worlds. Never commit production child data.

## Golden tests

Test structured meaning rather than exact generated prose.

## Accessibility tests

- automated axe checks
- keyboard navigation
- screen-reader walkthrough
- text scaling
- reduced motion

## Security tests

- cross-family ID access
- signed URL expiry
- rejected asset access
- hidden bible leakage
- unauthorised regeneration

## Performance tests

- home/library query load
- reader payload
- workflow status polling
- image derivative delivery
- background-job concurrency

## Acceptance criteria

- Every serious production failure becomes a regression test where practical.
- No provider call is required for standard CI.
- Paid evaluation is mandatory before model or prompt promotion.
