# The Lantern Engine

## Purpose

The Lantern Engine is Storylight’s deterministic storytelling orchestration layer. It coordinates planning, writing, review, continuity, illustration planning, generation, and publication.

It is not an autonomous agent.

## Responsibilities

The Lantern Engine owns:

- workflow sequence
- authoritative context selection
- schema validation
- domain validation
- review thresholds
- continuity transitions
- persistence
- idempotency
- retries
- publication rules
- cost budgets
- generation lineage

Models contribute bounded creative or analytical results.

## Primary flows

### One-off story

```text
Idea
→ Story DNA
→ Complete plan
→ Draft
→ Review
→ Revision if required
→ Continuity additions
→ Illustration plan
→ Publish text
→ Generate and review illustrations
```

### Series

```text
Idea
→ Story DNA
→ Complete series bible
→ Persist bible
→ Chapter blueprint
→ Chapter plan
→ Draft
→ Review
→ Continuity transition
→ Illustration plan
→ Publish
→ Repeat when next chapter is requested
```

## State principles

- The database is the source of truth.
- Every long-running workflow is resumable.
- Every significant stage persists its validated result.
- Duplicate commands return the existing workflow.
- Only one workflow may generate a given series chapter.
- Published chapters are immutable revisions.
- Rejected content is never exposed to reader APIs.

## Service boundaries

```ts
interface StoryWorkflowCoordinator {
  createOneOff(command: CreateOneOffStoryCommand): Promise<WorkflowHandle>;
  createSeries(command: CreateSeriesCommand): Promise<WorkflowHandle>;
  generateNextChapter(command: GenerateNextChapterCommand): Promise<WorkflowHandle>;
  regenerateChapter(command: RegenerateChapterCommand): Promise<WorkflowHandle>;
  resume(workflowId: string): Promise<WorkflowHandle>;
}
```

Supporting ports include:

- StoryPlanner
- SeriesPlanner
- ChapterPlanner
- ChapterWriter
- StoryReviewer
- ChapterReviser
- ContinuityExtractor
- ContinuityValidator
- IllustrationPlanner
- IllustrationGenerator
- IllustrationReviewer
- WorkflowRepository
- JobDispatcher
- ObjectStorage
- LockService

## Publication gate

A chapter may publish only when:

1. Wire-schema validation passes.
2. Deterministic draft checks pass.
3. Narrative review approves it.
4. Safety policy passes.
5. Continuity changes validate.
6. The new continuity snapshot is stored atomically with the chapter revision.

Illustrations may follow asynchronously if text-first publication is enabled.

## Failure philosophy

- A failed image must not discard approved text.
- A failed chapter must not advance the series.
- A timeout must leave the workflow resumable.
- A duplicate request must not trigger duplicate provider calls.
- A fallback must not weaken validation.
