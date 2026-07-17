<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# CLAUDE.md

## Project

Storylight is a mobile-first, private family application for creating personalised illustrated bedtime stories.

Read `docs/README.md` before making architectural changes.

Concrete infrastructure choices (hosting, DB, storage, jobs, auth, models) are recorded in `docs/decisions/ADR-006-concrete-infrastructure.md`. `BUILD_STATE.md` at the repo root is the cross-session build log — read it before starting a milestone and update it when you finish one.

## Product rule

Storylight must feel like a premium children’s publishing experience, not an AI chat application.

## Required architecture

- Next.js App Router
- React Server Components by default
- Strict TypeScript
- Tailwind CSS
- Postgres
- Drizzle ORM
- Vercel AI SDK behind Storylight-owned adapters
- Durable background workflows
- Private object storage
- Zod v4 at runtime boundaries

## Non-negotiable domain rules

1. Series are planned completely before Chapter 1 is written.
2. Story continuity is structured canonical data.
3. Models never write directly to canonical state.
4. Every model output is wire-schema validated and domain validated.
5. Published chapters and illustrations are immutable revisions.
6. Persistent character illustrations use approved reference assets.
7. Wrong child identity is a blocking image failure.
8. Existing series pin prompt, schema, model-route, and visual-profile versions.
9. Rejected content is never returned by reader APIs.
10. Mobile is the primary product surface.
11. Parent controls must remain available but visually secondary during reading.
12. Provider SDKs must not leak into domain or frontend code.

## How to approach implementation tasks

Before coding:

1. Identify the domain area.
2. Read only the relevant files from `docs/`.
3. State the invariants the change must preserve.
4. Inspect existing types and migrations.
5. Implement the smallest coherent vertical slice.
6. Add tests for domain behaviour and failure recovery.
7. Update the relevant documentation or ADR when architecture changes.

## Do not

- Build autonomous multi-agent workflows.
- Use chat history as story memory.
- Put provider calls in React components.
- Generate database IDs with a model.
- parse JSON with regular expressions.
- Store image bytes in Postgres.
- expose raw prompts, hidden series plans, or provider errors to clients.
- add a dependency when a small local abstraction is sufficient.
- change an existing series’ model or visual profile silently.
- create broad global client state without a demonstrated need.
- use child production data in automated tests.

## Required quality bar

Every change must include appropriate tests.

Canonical transitions such as continuity application, review policy, reference selection, and workflow state changes should be pure functions where practical.

Prefer database constraints plus application checks over application checks alone.

## Source of truth

When code and documentation disagree:

- existing production data and migrations must be preserved;
- identify the conflict;
- propose an ADR or documentation correction;
- do not silently invent a third design.
