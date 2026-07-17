# src/adapters

The ONLY place provider SDKs may be imported (domain rule 12, enforced by ESLint). Each subfolder implements a Storylight-owned port:

- `ai/` — Vercel AI SDK via AI Gateway; structured generation, image generation, vision review. Fake adapters for CI are first-class citizens here.
- `storage/` — `ObjectStorage` port → Vercel Blob (private, signed delivery).
- `jobs/` — `JobDispatcher` port → Vercel Workflow (WDK).
- `auth/` — Better Auth behind the `AuthenticatedActor` boundary.

Boundary rules:

- Adapters implement ports defined by the application/domain layers; they never define domain policy.
- Provider errors are mapped to typed domain errors — raw provider errors never escape.
- Concrete choices are recorded in `docs/decisions/ADR-006-concrete-infrastructure.md`; swapping a vendor means swapping an adapter, nothing else.
