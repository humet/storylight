import type { IllustrationRepository } from "../ports/illustration-repository";
import type { IllustrationJobStarter } from "../ports/illustration-job-starter";
import type {
  StageContext,
  StageResult,
  WorkflowStage,
} from "../workflow-engine";

/**
 * The final DISPATCH stage shared by the one-off and chapter pipelines. It runs
 * AFTER the publish stage (so the text publication has committed) and starts one
 * durable `generate-illustration` job per spec (`docs/03-ai/image-generation.md`;
 * `docs/05-backend/database.md`: dispatch background work only after commit).
 * TEXT-FIRST: images fill the placeholder slots asynchronously and NEVER block or
 * discard the already-published text.
 *
 * Bounded per-family concurrency is honoured with a simple cap on how many jobs one
 * publish dispatches at once. A chapter has at most `MAX_ILLUSTRATIONS` (5) specs,
 * comfortably under the cap, so it is never the binding constraint in MVP; it
 * guards against a pathological spec count. Each job is idempotent (a stable
 * per-spec request id dedupes), so a resume re-dispatch is a no-op.
 */
export const MAX_ILLUSTRATION_DISPATCH = 8;

export interface IllustrationDispatchDeps {
  illustrationRepository: IllustrationRepository;
  illustrationJobStarter: IllustrationJobStarter;
}

export function createDispatchIllustrationsStage(
  deps: IllustrationDispatchDeps,
  options: {
    key: string;
    publishStageKey: string;
    storyIdOf: (ctx: StageContext) => string;
  },
): WorkflowStage {
  return {
    key: options.key,
    label: "Sending the pictures to be painted",
    run: async (ctx: StageContext): Promise<StageResult> => {
      const { execution } = ctx;
      const publish = (await ctx.getStageOutput(options.publishStageKey)) as {
        revisionId: string;
      };
      const storyId = options.storyIdOf(ctx);
      const specIds =
        await deps.illustrationRepository.listSpecIdsForChapterRevision(
          execution.familyId,
          publish.revisionId,
        );
      const capped = specIds.slice(0, MAX_ILLUSTRATION_DISPATCH);
      for (const specId of capped) {
        await deps.illustrationJobStarter.start({
          familyId: execution.familyId,
          userId: execution.userId,
          storyId,
          specId,
        });
      }
      return { output: { dispatched: capped.length, total: specIds.length } };
    },
  };
}
