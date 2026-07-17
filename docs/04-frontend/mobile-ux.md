# Mobile UX

## Purpose

Define the mobile interaction model for creating, reading, continuing, and managing Storylight stories.

## Information architecture

Bottom navigation outside the reader:

- Home
- Library
- Create
- Parent

The Reader uses a focused full-screen shell without persistent bottom navigation.

## Home

Priority order:

1. Continue current series
2. Read a recently generated story
3. Create a new adventure
4. Browse favourites

Do not show operational dashboards.

## Create flow

### Step 1 — Idea

Large input:

> What should tonight’s story be about?

Support keyboard and optional voice input.

### Step 2 — Characters

Visual cards for approved child characters and recurring companions.

### Step 3 — Format

- One story tonight
- A story to continue

### Step 4 — Optional parent choices

Collapsed by default:

- length
- tone
- suspense
- themes
- chapter count

### Step 5 — Start

Immediately create a durable workflow and navigate to progress.

## Progress

Display real workflow stages, not token streams. The parent may leave and return.

Provide:

- story title when known
- current stage
- safe retry on failure
- notification or in-app indicator when ready

## Parent controls

Keep destructive or advanced actions behind a clear parent surface:

- regenerate
- edit profile
- retire story
- delete
- change safety settings
- view generation problem details

Do not rely on a hidden gesture as the only access.

## One-handed design

- Primary controls near lower centre or lower right/left.
- Avoid two-handed pinch requirements.
- Avoid tiny inline icon buttons.
- Confirm destructive actions.
- Preserve draft input on navigation.

## Empty states

Make the first useful action obvious.

Example:

> Your family library is waiting for its first adventure.

Button:

> Create tonight’s story

## Error recovery

Every failure state should say:

- what was preserved
- whether the parent can retry
- whether the story is still safe
- whether images can arrive later

## Acceptance criteria

- Complete creation flow works at 320px.
- No required interaction depends on hover.
- Workflows continue when the browser is backgrounded.
- Parent settings remain accessible but do not clutter the child-facing experience.
