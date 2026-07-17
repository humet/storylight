# Cost Management

## Principle

Optimise accepted-result cost without lowering safety, continuity, or identity standards.

## Cost units

Track cost per:

- one-off plan
- one-off accepted story
- series bible
- accepted chapter
- approved illustration
- completed five-chapter series
- completed ten-chapter series

## Accepted-result cost

Include:

- initial generation
- schema repair
- review
- revision
- fallback
- image generation
- image review
- image repair
- premium escalation

## Budgets

Every workflow has an explicit budget.

```ts
interface WorkflowBudget {
  maximumTextCalls: number;
  maximumImageCalls: number;
  maximumOutputTokens: number;
  maximumEstimatedCostMinorUnits: number;
}
```

## Cost controls

- bounded retries
- lower-cost models for validated routine tasks
- prompt caching where effective
- minimum necessary context
- 2K rather than 4K routine images
- text-first publication
- no speculative generation of all future chapters
- derivatives instead of serving originals
- evaluation before switching to cheaper models

## User-facing policy

Do not expose token accounting to children.

Parent surfaces may later show plan limits or usage, but language should remain product-oriented.

## Alerts

- per-workflow budget exceeded
- daily cost anomaly
- provider pricing change
- image repair spike
- fallback spike
- evaluation budget exceeded

## Historical pricing

Version pricing records by effective date. Never recalculate old generation costs using current prices.

## Acceptance criteria

- Every provider call has recorded usage.
- Every accepted chapter has a complete cost breakdown.
- A cheap but failure-prone model cannot appear artificially inexpensive.
