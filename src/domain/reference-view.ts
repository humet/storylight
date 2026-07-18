/**
 * Canonical character reference views (`docs/03-ai/image-generation.md`
 * "Character identity"). A character's visual identity is a versioned APPROVED
 * asset set — one asset per view — not a prose prompt (ADR-003).
 *
 * The list is ORDERED by identity priority: the front portrait is the primary
 * identity anchor, so it comes first everywhere the set is rendered or selected.
 * Ordering lives here as a pure, exhaustively-testable concern; nothing in this
 * module does IO.
 *
 * The MVP generates the core six views below. `scale-comparison` from the doc is
 * deferred until a scale reference object exists (there is nothing meaningful to
 * compare a fictional character against yet — recorded in BUILD_STATE).
 */
export const REFERENCE_VIEWS = [
  "front-portrait",
  "three-quarter",
  "full-body-front",
  "side-view",
  "expression",
  "default-outfit",
] as const;

export type ReferenceView = (typeof REFERENCE_VIEWS)[number];

/** Warm, parent-facing labels for each view (`docs/company/writing-style.md`). */
export const REFERENCE_VIEW_LABELS: Record<ReferenceView, string> = {
  "front-portrait": "Front portrait",
  "three-quarter": "Three-quarter",
  "full-body-front": "Full body",
  "side-view": "Side view",
  expression: "Expressions",
  "default-outfit": "Everyday outfit",
};

const VIEW_ORDER: Record<ReferenceView, number> = REFERENCE_VIEWS.reduce(
  (acc, view, index) => {
    acc[view] = index;
    return acc;
  },
  {} as Record<ReferenceView, number>,
);

/**
 * Order any collection carrying a `view` by the canonical identity priority
 * (front portrait first). Stable and pure — returns a new array, leaving the
 * input untouched. Used to lay out a candidate/reference set consistently and to
 * assign deterministic positions in the approved reference set.
 */
export function orderByReferenceView<T extends { view: ReferenceView }>(
  items: readonly T[],
): T[] {
  return [...items].sort((a, b) => VIEW_ORDER[a.view] - VIEW_ORDER[b.view]);
}

/** True when `value` is one of the canonical reference views. */
export function isReferenceView(value: unknown): value is ReferenceView {
  return (
    typeof value === "string" &&
    (REFERENCE_VIEWS as readonly string[]).includes(value)
  );
}
