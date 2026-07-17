# ADR-004: Capability-Based Model Routing

**Status:** Accepted

## Context

Different storytelling stages need different model strengths, and provider catalogues change.

## Decision

Domain services request capabilities. A versioned Model Registry resolves provider and model targets.

## Consequences

- Provider SDKs remain in adapters.
- Existing series pin route versions.
- New models require evaluation.
- Fallbacks preserve the same contracts.
- Model migrations do not require domain rewrites.
