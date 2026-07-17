# Story Reader

## Purpose

The Reader is the core product experience. It should feel like reading a premium illustrated book, not consuming generated content in a feed.

## MVP reading mode

Use a continuous vertical reader for reliability, accessibility, and natural mobile scrolling.

Page-turn mode may be added later, but must not replace accessible continuous reading.

## Structure

```text
Reader header
Cover or opening illustration
Chapter title
Story paragraphs
Inline illustrations at planned anchors
End-of-chapter treatment
Tomorrow promise
Close-book action
```

## Reader header

Minimal controls:

- Close book
- Text settings
- Optional chapter list for a series
- Parent options behind a menu

Hide controls during scrolling and reveal them predictably.

## Typography

- Default body size: 18–21px on common phones
- Adjustable size
- Comfortable line height
- Left aligned
- No justified text
- Paragraph spacing rather than first-line indentation for MVP
- Maximum readable width on tablets and desktop

## Illustration behaviour

- Reserve aspect ratio before loading
- Use responsive derivatives
- Never show quarantined or rejected images
- Allow fullscreen viewing
- Provide concise alt text
- Preserve text if image is pending
- Avoid layout shift when an image arrives

## Reading progress

Persist:

- story or chapter ID
- paragraph anchor or scroll proportion
- last read timestamp
- completed state

Avoid aggressive automatic completion. Mark complete when the parent reaches the closing section or explicitly closes after reading.

## End of chapter

A series chapter ends with:

- local emotional close
- subtle divider
- “End of Chapter N”
- gentle tomorrow promise
- “Close the book”

Do not automatically start the next chapter.

## Parent actions

- Try another wording
- Regenerate an illustration
- Report a problem
- Favourite
- Restart chapter

These should be visually secondary.

## Accessibility

- Semantic headings and paragraphs
- Screen-reader-friendly image alt text
- Text scaling
- Reduced motion
- Focus management
- No gesture-only navigation
- High contrast that still feels calm

## Offline resilience

Cache the current approved chapter payload and image derivatives for short-term interrupted connectivity. Never cache hidden series bible data client-side.

## Acceptance criteria

- Reading works with JavaScript-enhanced navigation but core text remains server-renderable.
- No rejected image can flash into view.
- Scroll position survives refresh.
- A child cannot accidentally trigger destructive parent actions.
