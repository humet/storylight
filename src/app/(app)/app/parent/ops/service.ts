import "server-only";

import { createOpsQueries } from "@/application/ops-queries";
import { getDb } from "@/db/client";
import { createFamilyRepository } from "@/db/repositories/family-repository";
import { createOpsRepository } from "@/db/repositories/ops-repository";

/**
 * Composition root for the owner-only OPS summary (mirrors `getStoryServices()`).
 * Server-only; wires the family repository (for authorisation) + the ops
 * repository (DB aggregates) into the {@link createOpsQueries} service.
 */
export async function getOpsQueries() {
  const db = await getDb();
  return createOpsQueries({
    familyRepository: createFamilyRepository(db),
    opsRepository: createOpsRepository(db),
  });
}
