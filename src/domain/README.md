# src/domain

Pure domain types and pure functions: continuity application, review policy, reference selection, workflow state transitions, and the entities they operate on.

Boundary rules:

- No IO. No database, network, provider, or filesystem access.
- No provider SDK imports (enforced by ESLint).
- Domain types stay independent of DB row types (`docs/06-engineering/coding-standards.md`).
- Canonical state transitions live here as pure, unit-tested functions.
- Server-side only: entry modules import `server-only` once real code lands (M1).
