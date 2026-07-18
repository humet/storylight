/**
 * ILLUSTRATION JOB STARTER port. Bridges the text pipelines to the per-spec image
 * jobs: after the text publication COMMITS (`docs/05-backend/database.md`: dispatch
 * background work only after the transaction commits), the publish stage asks this
 * to start one durable `generate-illustration` workflow per spec. Implemented in
 * the composition root (it needs the workflow repository + the dispatcher), so the
 * pipeline depends only on this small port (rule 12) and never on infra. Starting
 * is idempotent — a stable per-spec request id dedupes re-runs.
 */
export interface IllustrationJobStarter {
  start(input: {
    familyId: string;
    userId: string;
    storyId: string;
    specId: string;
  }): Promise<void>;
}
