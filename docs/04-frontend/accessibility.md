# Accessibility

## Principle

Accessibility is part of the product experience, not a later compliance pass.

## Standards

Target WCAG 2.2 AA for the web application.

## Semantics

- Use real headings in logical order.
- Use buttons for actions and links for navigation.
- Story prose uses semantic paragraphs.
- Dialogs trap focus correctly and restore it on close.
- Form controls have persistent labels.

## Keyboard

All functionality must be available by keyboard on desktop.

No action may require:

- hover
- drag only
- swipe only
- long press only

## Screen readers

- Announce workflow stage changes politely.
- Do not repeatedly announce cosmetic loading messages.
- Provide concise image alt text.
- Hide decorative texture from accessibility trees.
- Expose chapter and series structure clearly.

## Text

- Support 200% zoom without loss of content.
- Avoid fixed-height prose containers.
- Allow adjustable reader text size.
- Maintain readable line length on larger screens.

## Motion

Respect reduced motion.

Replace page-turn effects with simple fades or no transition.

## Colour

Do not use colour as the only indicator of:

- failure
- completion
- selection
- review state

## Voice input

Voice input is optional enhancement, not a requirement. The text path must remain complete.

## Cognitive load

- Use plain language.
- Keep creation steps short.
- Show one major decision at a time.
- Preserve entered data after errors.
- Avoid countdowns and urgency.

## Testing

- automated accessibility checks
- keyboard-only walkthrough
- VoiceOver on iOS
- TalkBack on Android
- 200% text scaling
- reduced motion
- colour-contrast validation

## Acceptance criteria

- Core mobile flows can be completed with a screen reader.
- The reader remains usable at enlarged text sizes.
- Pending images do not disrupt reading order.
