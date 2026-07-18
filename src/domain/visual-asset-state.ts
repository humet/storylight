import { invalidCommandError } from "@/lib/errors";
import type { VisualAssetState } from "./visual-asset";

/**
 * Visual-asset lifecycle transitions as a pure, total function
 * (`docs/05-backend/storage.md` "Asset states"). Kept in the domain with no IO
 * so it is exhaustively unit-testable and reused by the approval command and the
 * repository. An illegal move throws a client-safe `INVALID_COMMAND` rather than
 * silently coercing — the invariant that only `quarantined` can become
 * `approved` (and only `approved` can be delivered) depends on it.
 *
 * Legal moves:
 *  - `approve`:          quarantined → approved   (parent approves a candidate)
 *  - `reject`:           quarantined → rejected   (a candidate is discarded)
 *  - `retire`:           approved    → retired    (a superseded reference set)
 *  - `mark-for-deletion` any         → deletion-pending (family/asset deletion)
 */
export type VisualAssetTransition =
  "approve" | "reject" | "retire" | "mark-for-deletion";

const RULES: Record<
  VisualAssetTransition,
  { from: readonly VisualAssetState[]; to: VisualAssetState }
> = {
  approve: { from: ["quarantined"], to: "approved" },
  reject: { from: ["quarantined"], to: "rejected" },
  retire: { from: ["approved"], to: "retired" },
  "mark-for-deletion": {
    // Any live state can be scheduled for deletion (family or story removal).
    from: ["quarantined", "approved", "rejected", "retired"],
    to: "deletion-pending",
  },
};

/**
 * The state an asset reaches after applying `transition` to `current`. Throws
 * `INVALID_COMMAND` if the transition is not legal from `current`.
 */
export function applyVisualAssetTransition(
  current: VisualAssetState,
  transition: VisualAssetTransition,
): VisualAssetState {
  const rule = RULES[transition];
  if (!rule.from.includes(current)) {
    throw invalidCommandError({
      safeMessage: "That image can no longer change in this way.",
      internalDetail: `Illegal visual-asset transition "${transition}" from state "${current}" (requires one of ${rule.from.join(", ")}).`,
      stage: "visual-asset.state",
    });
  }
  return rule.to;
}

/**
 * Whether an asset in `state` may be delivered to a reader. ONLY `approved`
 * assets are deliverable (`docs/05-backend/storage.md`) — the single predicate
 * every delivery path must honour so rejected/quarantined bytes stay unreachable.
 */
export function isDeliverable(state: VisualAssetState): boolean {
  return state === "approved";
}
