# src/lib

Cross-cutting utilities: Zod env validation (`env.ts`, M1), typed domain errors carrying `{code, safeMessage, internalDetail, retryable, stage, correlationId}`, branded ID helpers.

Boundary rules:

- No provider SDK imports.
- Errors expose only safe domain codes to clients (`docs/05-backend/api.md`): raw provider errors, prompts, and internals never leave the server.
