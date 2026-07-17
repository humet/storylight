# Coding Standards

## TypeScript

- `strict: true`
- Avoid `any`
- Prefer discriminated unions
- Validate external data at runtime
- Use exhaustive checks
- Use branded IDs where valuable
- Keep domain types independent of database row types

## Functions

Prefer small functions with explicit inputs and outputs.

Pure functions are required for:

- continuity application
- review policy
- workflow transitions
- complexity calculation
- reference prioritisation

## Errors

Use typed domain errors with:

- code
- safe message
- internal detail
- retryability
- stage
- correlation ID

## Naming

Use domain names:

- `SeriesBible`
- `ChapterRevision`
- `ContinuitySnapshot`

Avoid vague names:

- `data`
- `result2`
- `manager`
- `helper`

## React

- Server Components by default
- Client Components only for interaction
- Avoid effects for data fetching
- Preserve accessibility semantics
- Keep business logic outside components

## Database

- Queries live in repositories or query services
- Transactions are explicit
- Migrations are committed
- Constraints back up application assumptions

## AI

- Provider imports only in adapters
- Prompts source controlled
- Schemas versioned
- Model output never trusted
- No model call inside a React component

## Comments

Explain why, not what. Complex domain invariants deserve comments and tests.

## Formatting and linting

Use one formatter and one lint configuration across the repository. CI must enforce them.

## Acceptance criteria

- A new engineer can trace a chapter workflow without provider-specific knowledge.
- Canonical state changes are explicit and tested.
