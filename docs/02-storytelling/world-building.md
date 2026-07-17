# World Building

## Purpose

Worlds provide familiarity, rules, recurring places, and visual consistency. They may exist for one story or persist across many family adventures.

## World types

### Story-local world

Exists only within one one-off story or series.

### Reusable family world

May return across unrelated stories after approval.

Examples:

- Moonwood Library
- Axolotl Hotel
- a magical campsite
- a seaside village

## World profile

```ts
interface WorldProfile {
  id: string;
  familyId: string;
  key: string;
  name: string;
  version: number;
  status: "draft" | "active" | "retired";

  premise: string;
  rules: WorldRule[];
  locations: LocationProfile[];
  recurringCharacters: string[];
  recurringObjects: string[];
  visualProfileId?: string;
}
```

## World rules

Rules should be:

- clear
- narratively useful
- limited in number
- testable
- stable unless deliberately changed

Example:

```text
The twelve doors in Moonwood Library open only when a reader
understands the question written above them.
```

Avoid vague systems where magic can solve any problem without cost or choice.

## Locations

Each recurring location stores:

- purpose
- fixed features
- variable features
- spatial relationships
- atmosphere
- visual profile
- known facts
- discovered state

## Discovery

A series may reveal a world gradually. The hidden bible can know more than the characters, but chapter context should include only currently relevant and allowed information.

## Reuse

When reusing a world:

- preserve established rules
- preserve fixed locations
- select relevant previous events
- avoid requiring the parent to remember every older story
- provide enough reorientation for a new story

## World memory

Do not make every decorative detail canonical. Persist facts likely to matter again.

## Parent controls

Parents can:

- rename a world
- retire it
- mark it favourite
- approve reusable companions
- prevent reuse of a theme
- reset or branch a world deliberately

## Acceptance criteria

- Magic follows understandable rules.
- Recurring places remain recognisable.
- Reuse creates familiarity without requiring encyclopaedic context.
- Visual and narrative world profiles remain linked but separately versioned.
