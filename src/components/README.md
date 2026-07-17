# src/components

Storylight design-system components per `docs/04-frontend/design-system.md` (Button, IconButton, TextField, TextArea, CharacterCard, StoryCard, SeriesProgressCard, SegmentedChoice, Sheet, Dialog, Menu, ProgressStage, ReaderImage, ReaderTypographyControls, EmptyState, ErrorState, ParentGate).

Boundary rules:

- Server Components by default; Client Components only where interaction requires them — never convert a whole route for one control.
- No provider SDK imports, no model calls, no direct DB access (use query services).
- Tokens via CSS custom properties (Paper light / Lamplight dark); touch targets ≥ 44×44 px; WCAG 2.2 AA.
- Radix primitives allowed ONLY for Dialog/Sheet/Menu focus management (ADR-006).
- Every component gets Storybook stories, including dark theme and 320px viewport (from M1).
