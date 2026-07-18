import type { DeletionStep } from "@/domain/family-deletion";

/**
 * PORT for the auditable family-deletion workflow (`docs/05-backend/database.md`
 * "Deletion"). Each method is a resumable, idempotent step; the Drizzle impl lives
 * in `src/db/repositories/family-deletion-repository.ts`. The workflow drives
 * these in order and records an audit row per completed step.
 */
export interface FamilyDeletionRepository {
  /** Owner user-ids for a family (for the last-owner orphan guard). */
  listOwnerUserIds(familyId: string): Promise<string[]>;

  /** Whether the family already carries a deletion tombstone (`deleted_at`). */
  isDeleted(familyId: string): Promise<boolean>;

  /**
   * STEP 1 — revoke access: anonymise the family name, stamp `deleted_at`, and
   * delete every `family_members` row (so membership-based authorisation now
   * fails and reader/delivery routes 404). Idempotent.
   */
  revokeAccess(familyId: string): Promise<void>;

  /**
   * STEP 2 — collect every private object-storage key for the family (character
   * reference/candidate assets + chapter illustration originals AND derivatives),
   * read from the DB (the store has no list-by-prefix). The workflow deletes each
   * key via the {@link import("./object-storage").ObjectStorage} port BEFORE the
   * rows are purged.
   */
  collectStorageKeys(familyId: string): Promise<string[]>;

  /**
   * STEP 3 — purge all family-scoped CONTENT: child profiles + versions +
   * relationships + visual profiles/assets/references, stories + chapters +
   * revisions + publications + illustration specs/assets/revisions/reviews +
   * reading progress + series bibles/blueprints/snapshots/threads, story
   * preferences, raw model outputs (generation + image runs/artifacts), and every
   * OTHER workflow execution for the family (keeping ONLY the deletion workflow's
   * own row, whose family cascade would otherwise break the running engine). The
   * `families` tombstone remains. Idempotent (safe to re-run on resume).
   */
  purgeContent(familyId: string, keepWorkflowId: string): Promise<void>;

  /** Record a completed step (idempotent on `(familyId, step)`). */
  recordStep(input: {
    familyId: string;
    workflowId: string;
    step: DeletionStep;
    detail?: Record<string, unknown>;
  }): Promise<void>;

  /** The recorded audit steps for a family (audit trail assertion). */
  listAuditSteps(familyId: string): Promise<DeletionStep[]>;
}
