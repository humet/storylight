# Mobile-First Product Requirements

## Purpose

Storylight is designed for a parent reading in bed, often one-handed, in portrait orientation, and in dim lighting. Mobile support is not a responsive afterthought; it defines the product.

## Primary assumptions

- Viewport widths from 320px upward must be supported.
- Portrait orientation is the default.
- A parent may hold the phone and a child simultaneously.
- Input should be brief and voice-friendly.
- Network conditions may be inconsistent.
- Bedtime use favours calm, low-glare design.
- Reading should work without requiring precise taps.

## Interaction rules

- Primary touch targets must be at least 44 by 44 CSS pixels.
- Core actions belong within comfortable thumb reach.
- Avoid hover-only affordances.
- Avoid long multi-column forms.
- Do not hide essential actions behind long-press gestures.
- Preserve user progress when the app is backgrounded.
- Do not require landscape orientation.
- Support browser back without losing generated work.

## Navigation

Use a small mobile information architecture:

- Home
- Library
- Create
- Parent settings

During reading, remove global navigation from the main visual hierarchy. Provide a clear way to close the book and return to the library.

## Story creation

The default creation screen contains:

1. One large idea input.
2. Voice input where supported.
3. Character selection shown visually.
4. A simple choice: one story or a series.
5. An optional “More choices” section for parent controls.

Do not front-load advanced settings.

## Loading

Generation runs independently of the browser connection. The UI should show meaningful progress and allow the parent to leave.

Use calm labels such as:

- Planning the adventure
- Writing tonight’s chapter
- Painting the first page
- Adding the finishing touches

Do not show fake percentages unless they are backed by actual workflow progress.

## Reading

- Body text should default to approximately 18–21px on typical phones.
- Line length should remain comfortable.
- Text size must be adjustable.
- Avoid justified text.
- Reserve image space to prevent layout shift.
- Keep page controls away from text-selection gestures.
- Support a continuous vertical reading mode for MVP.
- Page-swipe mode may be introduced later if it remains accessible.

## Night mode

Night mode should reduce glare without using pure black and pure white. It must retain readable contrast.

Do not rely only on the current time. Allow the parent to choose:

- Light
- Dark
- System

## Offline and interruption behaviour

Once a chapter has loaded, the text and approved image URLs should remain available during short connection loss. Preserve the current scroll position locally.

## Acceptance criteria

- All MVP flows work at 320px width.
- No horizontal scrolling is required.
- A story can be created with one hand.
- Parent controls are reachable but not visually dominant.
- The reader passes accessibility checks at 200% text scaling.
- The app can be backgrounded during generation without cancelling the workflow.
