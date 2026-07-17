# Design System

## Purpose

Create a calm, book-like interface that remains consistent across creation, library, reader, and parent surfaces.

## Tokens

Define tokens for:

- colour
- typography
- spacing
- radius
- shadow
- motion
- z-index
- safe-area insets
- touch-target size

Use CSS custom properties so themes can change without rewriting components.

## Colour

Themes:

- Paper light
- Lamplight dark

Avoid pure white and pure black. Use warm neutrals and a restrained accent.

Status colours must remain distinguishable without dominating the interface.

## Typography

Use a highly readable UI/body family and a distinctive but readable display family for story titles.

Do not use decorative display type for long story prose.

Support:

- dynamic type scaling
- dyslexia-friendly optional font later
- tabular numbers where needed in parent screens

## Spacing

Use a small consistent scale. Reading layouts should have more vertical space than settings screens.

## Components

Core components:

- Button
- IconButton
- TextField
- TextArea
- CharacterCard
- StoryCard
- SeriesProgressCard
- SegmentedChoice
- Sheet
- Dialog
- Menu
- ProgressStage
- ReaderImage
- ReaderTypographyControls
- EmptyState
- ErrorState
- ParentGate

## Motion

Default durations should be restrained.

Respect `prefers-reduced-motion`.

Do not animate story text during reading.

## Icons

Use a consistent icon set. Icons require labels where meaning is not obvious.

## Content density

Child-facing surfaces are spacious.

Parent settings may be denser but must remain mobile friendly.

## Acceptance criteria

- Components meet touch-target requirements.
- Both themes pass contrast checks.
- Reader typography remains comfortable at 200% zoom.
- Design tokens prevent arbitrary one-off styling in product code.
