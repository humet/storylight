import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getWorkflowService } from "@/adapters/jobs";
import { CREATE_ONE_OFF_STORY_TYPE } from "@/application/workflows/create-one-off-story-workflow";
import { actorOrRedirect } from "../../../guard";
import { StoryProgressPoller } from "./StoryProgressPoller";

export const metadata: Metadata = {
  title: "Making your story — Storylight",
};

export const dynamic = "force-dynamic";

export default async function StoryProgressPage({
  params,
}: {
  params: Promise<{ storyId: string }>;
}) {
  const { storyId } = await params;
  const actor = await actorOrRedirect();

  const workflows = await getWorkflowService();
  const latest = await workflows.getLatestWorkflowForEntity(
    actor,
    CREATE_ONE_OFF_STORY_TYPE,
    storyId,
  );

  // No workflow, or it already finished — send the parent to the reader (which
  // itself 404s if the story is not readable).
  if (!latest) redirect(`/app/stories/${storyId}`);
  if (latest.isComplete) redirect(`/app/stories/${storyId}`);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-8 px-5 py-16">
      <StoryProgressPoller
        storyId={storyId}
        workflowId={latest.id}
        initialLabel={latest.label}
        initialStatus={latest.isFailed ? "failed" : "working"}
        initialErrorCode={latest.error?.code ?? null}
      />
    </main>
  );
}
