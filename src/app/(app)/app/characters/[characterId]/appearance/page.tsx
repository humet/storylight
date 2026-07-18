import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Button, ReferenceAssetFrame } from "@/components";
import { getWorkflowService } from "@/adapters/jobs";
import { GENERATE_CHARACTER_CANDIDATES_TYPE } from "@/application/workflows/generate-character-candidates-workflow";
import {
  REFERENCE_VIEW_LABELS,
  type ReferenceView,
} from "@/domain/reference-view";
import { actorOrRedirect } from "../../guard";
import { getCharacterServices } from "../../service";
import { getVisualCharacterService } from "../../visual-service";
import { AppearanceProgress } from "./AppearanceProgress";
import {
  approveCandidateSetAction,
  rejectCandidateSetAction,
  requestCandidatesAction,
} from "./actions";

export const metadata: Metadata = {
  title: "Character look — Storylight",
};

export const dynamic = "force-dynamic";

/** The expression sheet is landscape; every other reference view is portrait. */
function aspectFor(view: ReferenceView): "portrait" | "landscape" {
  return view === "expression" ? "landscape" : "portrait";
}

export default async function CharacterAppearancePage({
  params,
}: {
  params: Promise<{ characterId: string }>;
}) {
  const { characterId } = await params;
  const actor = await actorOrRedirect();

  const { queries } = await getCharacterServices();
  const profile = await queries.getCharacterProfile(actor, characterId);
  if (!profile) notFound();

  const visual = await getVisualCharacterService();
  const workflows = await getWorkflowService();
  const [approved, pendingSets, latestPaint] = await Promise.all([
    visual.getApprovedReferenceSet(actor, characterId),
    visual.listPendingCandidateSets(actor, characterId),
    workflows.getLatestWorkflowForEntity(
      actor,
      GENERATE_CHARACTER_CANDIDATES_TYPE,
      characterId,
    ),
  ]);

  const name = profile.displayName;
  const hasCandidates = pendingSets.length > 0;
  // A paint is in flight while its workflow has not reached a terminal state.
  const painting = latestPaint && !latestPaint.isTerminal ? latestPaint : null;
  const paintFailed = latestPaint?.isFailed ?? false;

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-8 px-5 py-8">
      <Link
        href={`/app/characters/${characterId}`}
        className="font-sans text-sm font-medium text-accent"
      >
        ← {name}
      </Link>

      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-semibold text-ink text-balance">
          {name}&rsquo;s look
        </h1>
        <p className="font-sans text-base text-ink-soft text-pretty">
          A set of reference paintings keeps {name} recognisable in every story.
          Paint a few options, then choose the set that feels most like them.
        </p>
      </header>

      {approved.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-xl font-semibold text-ink">
            {name}&rsquo;s current look
          </h2>
          <ul className="grid grid-cols-2 gap-3 min-[420px]:grid-cols-3">
            {approved.map((asset) => (
              <li key={asset.id}>
                <ReferenceAssetFrame
                  src={`/app/characters/${characterId}/references/${asset.id}`}
                  alt={`${name} — ${REFERENCE_VIEW_LABELS[asset.view]}`}
                  caption={REFERENCE_VIEW_LABELS[asset.view]}
                  aspect={aspectFor(asset.view)}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {painting ? (
        <AppearanceProgress
          characterId={characterId}
          workflowId={painting.id}
          initialLabel={painting.label}
        />
      ) : (
        <>
          {paintFailed && !hasCandidates ? (
            <section className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5">
              <p className="font-sans text-base text-ink text-pretty">
                {name}&rsquo;s paintings did not come together this time.
                Nothing was saved, and you can try again.
              </p>
            </section>
          ) : null}

          {hasCandidates ? (
            <section className="flex flex-col gap-6">
              <div className="flex flex-col gap-1">
                <h2 className="font-display text-xl font-semibold text-ink">
                  Choose {name}&rsquo;s look
                </h2>
                <p className="font-sans text-sm text-ink-soft text-pretty">
                  Have a look through each set. Approve the one you like best —
                  the others are set aside.
                </p>
              </div>

              {pendingSets.map((set, index) => (
                <article
                  key={set.id}
                  className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4"
                >
                  <h3 className="font-sans text-sm font-medium text-ink-muted">
                    Option {index + 1}
                  </h3>
                  <ul className="grid grid-cols-2 gap-3 min-[420px]:grid-cols-3">
                    {set.assets.map((asset) => (
                      <li key={asset.id}>
                        <ReferenceAssetFrame
                          src={`/app/characters/${characterId}/candidates/${asset.id}`}
                          alt={`${name} — ${REFERENCE_VIEW_LABELS[asset.view]}`}
                          caption={REFERENCE_VIEW_LABELS[asset.view]}
                          aspect={aspectFor(asset.view)}
                        />
                      </li>
                    ))}
                  </ul>
                  <div className="flex flex-col gap-2">
                    <form action={approveCandidateSetAction}>
                      <input
                        type="hidden"
                        name="characterId"
                        value={characterId}
                      />
                      <input
                        type="hidden"
                        name="candidateSetId"
                        value={set.id}
                      />
                      <Button type="submit" size="lg" fullWidth>
                        Use this look
                      </Button>
                    </form>
                    <form action={rejectCandidateSetAction}>
                      <input
                        type="hidden"
                        name="characterId"
                        value={characterId}
                      />
                      <input
                        type="hidden"
                        name="candidateSetId"
                        value={set.id}
                      />
                      <Button type="submit" variant="ghost" fullWidth>
                        Not this one
                      </Button>
                    </form>
                  </div>
                </article>
              ))}
            </section>
          ) : (
            <section className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5">
              <p className="font-sans text-base text-ink text-pretty">
                {approved.length > 0
                  ? `Want to try a different look for ${name}? Paint a fresh set of options.`
                  : `Ready to see ${name}? Paint the first set of options to choose from.`}
              </p>
              <form action={requestCandidatesAction}>
                <input type="hidden" name="characterId" value={characterId} />
                <Button type="submit" size="lg" fullWidth>
                  Paint {name}
                </Button>
              </form>
            </section>
          )}

          {hasCandidates ? (
            <form action={requestCandidatesAction}>
              <input type="hidden" name="characterId" value={characterId} />
              <Button type="submit" variant="secondary" fullWidth>
                Paint a different set
              </Button>
            </form>
          ) : null}
        </>
      )}
    </main>
  );
}
