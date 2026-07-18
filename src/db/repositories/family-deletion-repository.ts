import { and, eq, ne } from "drizzle-orm";

import type { FamilyDeletionRepository } from "@/application/ports/family-deletion-repository";
import type { DeletionStep } from "@/domain/family-deletion";
import { DELETED_FAMILY_NAME } from "@/domain/family-deletion";
import type { Database } from "../client";
import {
  childCharacters,
  families,
  familyDeletionAudit,
  familyMembers,
  generationArtifacts,
  generationRuns,
  illustrationAssets,
  imageGenerationRuns,
  stories,
  storyPreferences,
  visualAssets,
  workflowExecutions,
} from "../schema";

/**
 * Drizzle impl of {@link FamilyDeletionRepository}. The purge deletes the top of
 * each family subtree (stories, child characters, other workflows) and lets the
 * DB `onDelete: cascade` FKs remove the children, plus a DEFENSIVE family-scoped
 * sweep of the run tables (whose `family_id` is nullable / whose `workflow_id`
 * carries no FK), all in one transaction. The `families` row is kept as an
 * anonymised tombstone (see the schema note).
 */
export function createFamilyDeletionRepository(
  db: Database,
): FamilyDeletionRepository {
  return {
    async listOwnerUserIds(familyId) {
      const rows = await db
        .select({ userId: familyMembers.userId, role: familyMembers.role })
        .from(familyMembers)
        .where(eq(familyMembers.familyId, familyId));
      return rows.filter((r) => r.role === "owner").map((r) => r.userId);
    },

    async isDeleted(familyId) {
      const [row] = await db
        .select({ deletedAt: families.deletedAt })
        .from(families)
        .where(eq(families.id, familyId))
        .limit(1);
      return Boolean(row?.deletedAt);
    },

    async revokeAccess(familyId) {
      await db.transaction(async (tx) => {
        await tx
          .update(families)
          .set({ name: DELETED_FAMILY_NAME, deletedAt: new Date() })
          .where(eq(families.id, familyId));
        // Revoke access: no member can authorise against this family any more.
        await tx
          .delete(familyMembers)
          .where(eq(familyMembers.familyId, familyId));
      });
    },

    async collectStorageKeys(familyId) {
      const visual = await db
        .select({ key: visualAssets.storageKey })
        .from(visualAssets)
        .where(eq(visualAssets.familyId, familyId));
      const illustration = await db
        .select({ key: illustrationAssets.storageKey })
        .from(illustrationAssets)
        .where(eq(illustrationAssets.familyId, familyId));
      return [...visual, ...illustration].map((r) => r.key);
    },

    async purgeContent(familyId, keepWorkflowId) {
      await db.transaction(async (tx) => {
        // Stories cascade → chapters, revisions, publications, illustration specs
        // /assets/revisions/reviews/publications, reading progress, series bibles
        // /blueprints/snapshots/plot threads, image runs by story_id.
        await tx.delete(stories).where(eq(stories.familyId, familyId));
        // Child characters cascade → profile versions, relationships, visual
        // profiles/assets/reference assets.
        await tx
          .delete(childCharacters)
          .where(eq(childCharacters.familyId, familyId));
        // Every OTHER workflow cascades → stage outputs, generation runs/artifacts
        // (by workflow_id). Keep the deletion workflow's own row.
        await tx
          .delete(workflowExecutions)
          .where(
            and(
              eq(workflowExecutions.familyId, familyId),
              ne(workflowExecutions.id, keepWorkflowId),
            ),
          );
        // Defensive sweep of the run tables (nullable family_id / no workflow FK).
        await tx
          .delete(imageGenerationRuns)
          .where(eq(imageGenerationRuns.familyId, familyId));
        await tx
          .delete(generationRuns)
          .where(eq(generationRuns.familyId, familyId));
        await tx
          .delete(generationArtifacts)
          .where(eq(generationArtifacts.familyId, familyId));
        // Story preferences (one row per family).
        await tx
          .delete(storyPreferences)
          .where(eq(storyPreferences.familyId, familyId));
      });
    },

    async recordStep(input) {
      await db
        .insert(familyDeletionAudit)
        .values({
          familyId: input.familyId,
          workflowId: input.workflowId,
          step: input.step,
          detail: input.detail ?? null,
        })
        .onConflictDoNothing({
          target: [familyDeletionAudit.familyId, familyDeletionAudit.step],
        });
    },

    async listAuditSteps(familyId) {
      const rows = await db
        .select({ step: familyDeletionAudit.step })
        .from(familyDeletionAudit)
        .where(eq(familyDeletionAudit.familyId, familyId))
        .orderBy(familyDeletionAudit.createdAt);
      return rows.map((r) => r.step as DeletionStep);
    },
  };
}
