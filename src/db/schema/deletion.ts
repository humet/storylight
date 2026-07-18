import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * FAMILY DELETION AUDIT (M10, `docs/05-backend/database.md` "Deletion",
 * `docs/05-backend/auth.md` "Audit"). One row per completed deletion STEP, so a
 * family deletion is fully auditable.
 *
 * `familyId` is a PLAIN uuid with NO foreign key on purpose: the deletion workflow
 * removes the family's content and would cascade a family-scoped audit away — the
 * audit trail must OUTLIVE the deletion. `UNIQUE(family_id, step)` makes step
 * recording idempotent, so a crashed-then-resumed deletion never double-records a
 * step.
 */
export const familyDeletionAudit = pgTable(
  "family_deletion_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The family being deleted — plain uuid (NO FK, survives the purge). */
    familyId: uuid("family_id").notNull(),
    /** The deletion workflow execution that performed the step. */
    workflowId: uuid("workflow_id"),
    /** The step key ("revoke-access" | "purge-storage" | "purge-database"). */
    step: text("step").notNull(),
    /** Safe, id/count-level detail — never prose, prompts, or bytes. */
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("family_deletion_audit_family_step_unq").on(
      table.familyId,
      table.step,
    ),
    index("family_deletion_audit_family_idx").on(table.familyId),
  ],
);
