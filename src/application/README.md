# src/application

Command services, query services, and workflow coordinators. Server Actions and Route Handlers are thin adapters that validate input and call services here (`docs/05-backend/api.md`).

Boundary rules:

- Talks to ports (interfaces) only — never to provider SDKs directly.
- Commands validate with Zod, authorise via the `AuthenticatedActor` boundary, then run.
- Queries return purpose-built read models, never raw DB rows or hidden data (series bible, blueprints, prompts).
- Orchestration logic lives here, not in Server Actions or React components.
- Server-side only: entry modules import `server-only` once real code lands (M1).
