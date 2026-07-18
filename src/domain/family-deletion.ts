import { invalidCommandError } from "@/lib/errors";

/**
 * FAMILY DELETION domain (M10, `docs/05-backend/database.md` "Deletion",
 * `docs/05-backend/auth.md`). Pure declarations + guards; the durable workflow and
 * the repository do the IO.
 *
 * Family deletion must REMOVE OR ANONYMISE: child profiles, story prose, visual
 * references, generated images (+ derivatives), raw model outputs, and revoke
 * signed storage access — as an AUDITABLE, IDEMPOTENT, RESUMABLE workflow.
 */

/** The ordered, named deletion steps (each recorded in `family_deletion_audit`). */
export const DELETION_STEPS = [
  "revoke-access",
  "purge-storage",
  "purge-database",
] as const;

export type DeletionStep = (typeof DELETION_STEPS)[number];

/**
 * The OWNER-ORPHAN guard (the M2-noted case: deleting the last owner cascades the
 * membership away and would leave a family with no owner). Removing an owner is
 * only allowed when ANOTHER owner remains — otherwise the caller must either
 * transfer ownership first or delete the whole family (the sanctioned path, which
 * removes every member atomically). Pure; throws a client-safe error.
 */
export function assertOwnerRemovalAllowed(input: {
  ownerUserIds: readonly string[];
  removeUserId: string;
}): void {
  const { ownerUserIds, removeUserId } = input;
  const isOwner = ownerUserIds.includes(removeUserId);
  if (!isOwner) return; // removing a non-owner never orphans the family
  const remainingOwners = ownerUserIds.filter((id) => id !== removeUserId);
  if (remainingOwners.length === 0) {
    throw invalidCommandError({
      safeMessage:
        "This is the family's only owner. Transfer ownership or delete the family instead.",
      internalDetail: `Refusing to remove the last owner ${removeUserId}; it would orphan the family (no owners left).`,
      stage: "family.owner-orphan",
    });
  }
}

/** The anonymised name a deleted family's tenancy-root tombstone carries. */
export const DELETED_FAMILY_NAME = "Deleted family";
