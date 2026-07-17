# ADR-001: Mobile-First Product

**Status:** Accepted

## Context

Storylight is primarily used at bedtime. A parent may hold a phone and a child simultaneously, often in dim light.

## Decision

Design all core flows for portrait mobile use first. Desktop adapts from the mobile product.

## Consequences

- Creation uses short progressive steps.
- Touch targets meet mobile accessibility requirements.
- Reader design prioritises phone typography and image clarity.
- Hover-only interactions are prohibited.
- Generation continues when the browser is backgrounded.
- Desktop administration may use wider layouts, but cannot define core interaction patterns.
