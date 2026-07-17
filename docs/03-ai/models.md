# Model Strategy

## Core decision

Route by capability, not by provider or model name.

```ts
const model = modelRegistry.getLanguageRoute("chapter-writing", seriesProfile);
```

Domain code must not branch on a model identifier.

## Capabilities

Language:

- one-off planning
- series planning
- chapter planning
- chapter writing
- chapter review
- chapter revision
- continuity extraction
- illustration planning
- illustration review

Image:

- character reference generation
- style reference generation
- routine chapter illustration
- premium chapter illustration
- illustration repair

## Initial routing hypothesis

The initial implementation should keep model choices in a source-controlled configuration and evaluate them before production.

Recommended pattern:

- strongest reasoning model for series planning
- balanced structured-output model for routine planning and continuity
- prose-strong model for chapter writing
- separate model family for review where practical
- reference-capable image model for character and style assets
- faster reference-capable image model for routine illustrations
- premium escalation for complex scenes

Exact model IDs must be confirmed against current provider documentation at implementation time and recorded in route configuration.

## Route versioning

A model route version includes:

- capability
- primary target
- fallbacks
- generation settings
- lifecycle status
- evaluation profile
- approval record

Existing series pin their route versions to prevent voice or visual drift.

## Stable identifiers

Do not use mutable `latest` aliases in production. Record the resolved provider model identifier returned by the API.

## Fallbacks

Fallbacks are for availability failures:

- timeout
- rate limit
- temporary outage

They are not used to bypass poor review results.

Image fallback is stricter. Prefer same-provider repair and premium escalation before changing image families.

## Evaluation gate

A route cannot become active until it passes:

- schema reliability
- domain correctness
- continuity
- human creative review
- cost and latency
- failure-mode analysis
- rollback test

## Pricing

Maintain a versioned pricing registry outside workflow code. Track accepted-result cost, including retries, review, revision, and image repair.

## Lifecycle

Monitor provider deprecations and capability changes. A scheduled probe should verify every active route using synthetic data.
