# Frontend Application Architecture

## Stack

- Next.js App Router
- React Server Components by default
- Client Components only where interaction requires them
- TypeScript strict mode
- Tailwind CSS
- Server Actions for authenticated mutations where appropriate
- Route Handlers for webhooks, streaming status, and external callbacks

## Route structure

```text
app/
  (marketing)/
  (auth)/
  (app)/
    page.tsx
    library/
    create/
    stories/[storyId]/
    series/[seriesId]/
    characters/
    parent/
  api/
    workflows/
    webhooks/
```

## Rendering boundaries

Server Components:

- library queries
- story metadata
- chapter payload
- parent settings
- character lists

Client Components:

- idea input
- voice input
- progress subscription
- reader controls
- scroll-position persistence
- image fullscreen
- optimistic form affordances

Do not convert a whole route to a Client Component for one interactive control.

## Data fetching

Read through server-side query services.

Avoid direct database access from components.

```ts
const story = await storyQueries.getReaderStory({
  userId,
  storyId,
});
```

## Mutations

Server Actions should validate command schemas and call application services.

They must not contain orchestration logic.

## Progress updates

Use one of:

- polling with backoff for MVP
- Server-Sent Events if workflow infrastructure supports it cleanly

Do not keep the generation request open for the entire workflow.

## Client state

Use local component state for ephemeral UI.

Use URL state for navigable filters.

Use the server and database for canonical story state.

Do not introduce a broad global state library until a demonstrated need exists.

## Error boundaries

Define route-level error boundaries for:

- library
- story creation
- reader
- character setup
- parent settings

Errors should preserve safe navigation and retry.

## Security

Never send:

- hidden series bible
- future chapter blueprints
- provider credentials
- raw prompts
- generation-run internals
- private asset storage keys

Reader APIs expose only accepted published content.

## Acceptance criteria

- Domain and workflow imports remain server-only.
- Provider SDKs are not imported into frontend modules.
- Server Actions are thin command adapters.
- Reader content is authorised server-side.
