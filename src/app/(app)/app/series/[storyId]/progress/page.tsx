import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getWorkflowService } from "@/adapters/jobs";
import { requireActor } from "@/adapters/auth/require-actor";
import { CREATE_SERIES_TYPE } from "@/application/workflows/create-series-workflow";
import { actorOrRedirect } from "../../../guard";
import { SeriesProgressPoller } from "./SeriesProgressPoller";

export const metadata: Metadata = {
  title: "Making your series — Storylight",
};

export const dynamic = "force-dynamic";

export default async function SeriesProgressPage({
  params,
  searchParams,
}: {
  params: Promise<{ storyId: string }>;
  searchParams: Promise<{ w?: string }>;
}) {
  const { storyId } = await params;
  const { w } = await searchParams;
  await actorOrRedirect();

  const workflows = await getWorkflowService();

  // A specific workflow id (from create / continue), else the latest create-series.
  let latest = null;
  if (w) {
    const actor = await requireActor();
    latest = await workflows.getWorkflowStatus(actor, w);
  }
  latest ??= await workflows.getLatestWorkflowForEntity(
    await requireActor(),
    CREATE_SERIES_TYPE,
    storyId,
  );

  if (!latest) redirect(`/app/series/${storyId}`);
  if (latest.isComplete) redirect(`/app/series/${storyId}`);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-8 px-5 py-16">
      <SeriesProgressPoller
        storyId={storyId}
        workflowId={latest.id}
        initialLabel={latest.label}
        initialStatus={latest.isFailed ? "failed" : "working"}
        initialErrorCode={latest.error?.code ?? null}
      />
    </main>
  );
}
