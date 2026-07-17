# Storylight Engineering Culture

## Build systems, not prompt piles

Prompts are versioned assets inside a deterministic application. They are not the architecture.

## Explicit beats clever

Prefer readable domain code, clear state machines, and small services over hidden framework magic.

## Domain-first organisation

The codebase centres on:

- Character
- Story
- Series
- Chapter
- Continuity
- World
- Illustration
- Workflow

It does not centre on provider names.

## Strong types and runtime validation

TypeScript protects code written by us. Zod protects boundaries involving users, jobs, databases, and models.

## Pure functions for canonical transitions

Continuity application, review policy, and workflow transitions should be pure where possible and heavily tested.

## Immutable publication

Published content is revisioned, not mutated silently.

## Replaceable infrastructure

AI providers, storage, job execution, and authentication should sit behind ports.

## Operational empathy

Generation happens at bedtime. Failures should preserve state, avoid duplicate costs, and offer honest recovery.

## Document decisions

Meaningful architectural choices require ADRs.

## Leave evidence

Model and prompt changes require evaluations. “It looked better in one example” is not enough.
