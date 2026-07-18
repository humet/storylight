import type { ReferenceView } from "./reference-view";

/**
 * REFERENCE SELECTION (`docs/03-ai/image-generation.md` "Reference selection
 * priority"). APPLICATION CODE — never a model — chooses which approved reference
 * assets accompany an illustration request (ADR-003, rule 6). This module is the
 * PURE, exhaustively-tested heart of that choice: the exact 8-step priority order,
 * with the structural guarantee that one child's identity reference is NEVER
 * dropped to make room for scenery.
 *
 * The 8 priority slots (highest first):
 *   1. Identity reference for each child
 *   2. Second angle for the prominent child
 *   3. Outfit reference
 *   4. Plot-critical prop
 *   5. Location reference
 *   6. Style reference
 *   7. Supporting character
 *   8. Decorative object
 */

export type ReferenceSlot =
  | "identity"
  | "second-angle"
  | "outfit"
  | "prop"
  | "location"
  | "style"
  | "supporting"
  | "decorative";

/** Priority rank of each slot (1 = highest). Lower runs first. */
export const REFERENCE_SLOT_PRIORITY: Record<ReferenceSlot, number> = {
  identity: 1,
  "second-angle": 2,
  outfit: 3,
  prop: 4,
  location: 5,
  style: 6,
  supporting: 7,
  decorative: 8,
};

/** One approved asset available to reference, tagged by the view it depicts. */
export interface AvailableReferenceAsset {
  assetId: string;
  view: ReferenceView;
}

/** A child appearing in the scene, with their approved reference set. */
export interface SceneChild {
  characterKey: string;
  /** The child's approved reference assets (from the pinned/current visual profile). */
  references: AvailableReferenceAsset[];
  /** True for the most prominent child (gets a second angle earlier). */
  prominent: boolean;
}

/** A non-child reference the scene may pull in (prop / location / style / etc.). */
export interface SceneExtraReference {
  slot: Extract<
    ReferenceSlot,
    "prop" | "location" | "style" | "supporting" | "decorative"
  >;
  assetId: string;
  /** For lineage / debugging (e.g. the prop or location name). */
  label: string;
}

export interface SceneReferenceRequest {
  children: SceneChild[];
  extras: SceneExtraReference[];
}

export interface SelectedReference {
  slot: ReferenceSlot;
  assetId: string;
  /** Present for child-derived references (identity / second-angle / outfit). */
  characterKey?: string;
  view?: ReferenceView;
  label?: string;
}

export interface ReferenceBudget {
  /** Maximum references to attach. Identity references are exempt (never dropped). */
  maxReferences: number;
}

/** Pick a specific view from a child's set, else the first available. */
function pickView(
  child: SceneChild,
  preferred: ReferenceView,
): AvailableReferenceAsset | undefined {
  return (
    child.references.find((r) => r.view === preferred) ?? child.references[0]
  );
}

/**
 * Select the reference assets for one illustration in strict priority order,
 * respecting `budget.maxReferences` — EXCEPT that step 1 (one identity reference
 * per child) is guaranteed even if it exceeds the budget. This is the structural
 * enforcement of "Never omit one child's identity reference to include scenery":
 * identity slots are reserved first and can never be evicted by a later slot.
 *
 * Pure and deterministic: same request + budget → same ordered selection.
 */
export function selectReferences(
  request: SceneReferenceRequest,
  budget: ReferenceBudget,
): SelectedReference[] {
  const identity: SelectedReference[] = [];
  const optional: SelectedReference[] = [];

  // Step 1 — identity reference for EACH child (front portrait preferred). These
  // are MANDATORY: they are collected separately and never subject to the budget.
  for (const child of request.children) {
    const asset = pickView(child, "front-portrait");
    if (asset) {
      identity.push({
        slot: "identity",
        assetId: asset.assetId,
        characterKey: child.characterKey,
        view: asset.view,
      });
    }
  }

  // Step 2 — a SECOND angle for the prominent child (three-quarter, else side).
  for (const child of request.children) {
    if (!child.prominent) continue;
    const used = new Set(
      identity
        .filter((r) => r.characterKey === child.characterKey)
        .map((r) => r.assetId),
    );
    const second =
      child.references.find(
        (r) => r.view === "three-quarter" && !used.has(r.assetId),
      ) ??
      child.references.find(
        (r) => r.view === "side-view" && !used.has(r.assetId),
      ) ??
      child.references.find((r) => !used.has(r.assetId));
    if (second) {
      optional.push({
        slot: "second-angle",
        assetId: second.assetId,
        characterKey: child.characterKey,
        view: second.view,
      });
    }
  }

  // Step 3 — outfit reference (default-outfit) per child, if a distinct one exists.
  for (const child of request.children) {
    const used = new Set(
      [...identity, ...optional]
        .filter((r) => r.characterKey === child.characterKey)
        .map((r) => r.assetId),
    );
    const outfit = child.references.find(
      (r) => r.view === "default-outfit" && !used.has(r.assetId),
    );
    if (outfit) {
      optional.push({
        slot: "outfit",
        assetId: outfit.assetId,
        characterKey: child.characterKey,
        view: outfit.view,
      });
    }
  }

  // Steps 4–8 — extras in the documented priority order (prop, location, style,
  // supporting, decorative). Stable within a slot (input order preserved).
  const extraSlots: ReferenceSlot[] = [
    "prop",
    "location",
    "style",
    "supporting",
    "decorative",
  ];
  for (const slot of extraSlots) {
    for (const extra of request.extras) {
      if (extra.slot !== slot) continue;
      optional.push({
        slot: extra.slot,
        assetId: extra.assetId,
        label: extra.label,
      });
    }
  }

  // Budget: identity slots always survive; optional slots fill the REMAINING room
  // in priority order. If the budget is smaller than the identity set, scenery is
  // dropped entirely before any child identity — the structural guarantee.
  optional.sort(
    (a, b) => REFERENCE_SLOT_PRIORITY[a.slot] - REFERENCE_SLOT_PRIORITY[b.slot],
  );
  const remaining = Math.max(0, budget.maxReferences - identity.length);
  return [...identity, ...optional.slice(0, remaining)];
}
