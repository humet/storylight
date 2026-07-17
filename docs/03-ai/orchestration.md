# AI Orchestration

## Core decision

Use deterministic workflows with narrow model calls. Do not build a network of autonomous agents.

The application decides:

- which stage runs
- what context it receives
- what output schema applies
- whether the result passes
- what state changes
- what happens next

Models do not publish, write directly to the database, select arbitrary tools, or decide workflow order.

## Workflow execution

Every workflow record contains:

```ts
interface WorkflowExecution {
  id: string;
  type: string;
  status: "queued" | "running" | "waiting" | "completed" | "failed" | "cancelled";
  requestId: string;
  entityId?: string;
  currentStage: string;
  attempt: number;
  lastError?: WorkflowError;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}
```

## Stage persistence

After each major stage, store:

- validated output
- prompt version
- schema version
- model route version
- usage
- latency
- error status
- next eligible stage

Workflows must resume after deployment or timeout.

## Idempotency

Commands include a stable `requestId`.

Use uniqueness such as:

```text
UNIQUE(user_id, request_id, workflow_type)
```

Stage keys prevent duplicate provider calls.

## Chapter generation sequence

```text
Authorise
→ Load series
→ Determine next chapter
→ Acquire lock
→ Build context
→ Create chapter plan
→ Write draft
→ Deterministic validation
→ Narrative review
→ Revision if required
→ Extract continuity change set
→ Validate and apply continuity
→ Plan illustrations
→ Persist chapter and snapshot atomically
→ Publish
→ Dispatch image jobs
→ Release lock
```

## Revision policy

Allow at most two automatic text revisions by default.

If a chapter still fails, keep the workflow resumable and expose a safe retry to the parent.

## Fallbacks

Fallbacks address provider availability, not poor quality. A fallback result must pass the same schema, review, and publication thresholds.

## Budgets

Each workflow defines:

- maximum text calls
- maximum image calls
- maximum output tokens
- maximum estimated cost
- maximum automatic repairs

## State machine

Invalid transitions throw domain errors. State-transition rules belong in code and tests.

## Publication transaction

Atomically:

- create accepted chapter revision
- create continuity snapshot
- advance series chapter number
- create publication record

Dispatch images only after commit.

## Acceptance criteria

- No model call can update canonical state directly.
- Duplicate requests do not duplicate work.
- Concurrent next-chapter requests cannot publish the same chapter twice.
- Workflows resume from durable stages.
- Every model call is traceable.
