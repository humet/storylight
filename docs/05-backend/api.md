# API and Application Boundary

## Principle

The API exposes Storylight commands and accepted read models. It does not expose raw database tables or provider APIs.

## Commands

Examples:

- createCharacterProfile
- approveCharacterCandidate
- createOneOffStory
- createSeries
- generateNextChapter
- regenerateChapter
- regenerateIllustration
- updateStoryPreferences
- reportStoryProblem
- deleteStory

Commands validate with Zod and return a workflow handle or accepted entity reference.

## Queries

Examples:

- getHome
- getLibrary
- getStoryReader
- getSeriesSummary
- getWorkflowStatus
- getCharacterProfiles
- getParentSettings

Queries return purpose-built read models.

## Reader API

Must not include:

- hidden series bible
- future chapter blueprints
- rejected revisions
- raw prompts
- model metadata
- private storage keys

## Server Actions

Use for authenticated same-origin mutations when appropriate. Keep them thin:

```ts
export async function createSeriesAction(input: unknown) {
  const actor = await requireActor();
  const command = CreateSeriesCommandSchema.parse(input);
  return storyCommands.createSeries(actor, command);
}
```

## Route Handlers

Use for:

- workflow status stream
- webhooks
- signed asset delivery
- external provider callbacks
- health probes

## Error contract

Return safe domain codes:

- INVALID_COMMAND
- UNAUTHORISED
- SERIES_COMPLETE
- WORKFLOW_LOCKED
- SAFETY_REJECTION
- GENERATION_FAILED
- IMAGE_PENDING

Do not return raw provider errors.

## Versioning

Internal same-repo APIs can evolve with the app. External/public APIs require explicit versioning. The MVP does not expose a public API.

## Acceptance criteria

- All mutations validate and authorise before application services run.
- Reader payloads contain only accepted content.
- Raw provider responses never reach clients.
