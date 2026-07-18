import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Button, buttonClassName, StatusBadge } from "@/components";
import type { CharacterProfile } from "@/domain/character";
import {
  approveCharacterProfileAction,
  retireCharacterProfileAction,
} from "../actions";
import { actorOrRedirect } from "../guard";
import { getCharacterServices } from "../service";

export const metadata: Metadata = {
  title: "Character — Storylight",
};

export const dynamic = "force-dynamic";

function FactList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="font-sans text-sm font-medium text-ink-muted">{title}</h3>
      <ul className="flex flex-col gap-1">
        {items.map((item, i) => (
          <li key={i} className="font-sans text-base text-ink text-pretty">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function policyLines(profile: CharacterProfile): string[] {
  const p = profile.fictionalisationPolicy;
  const allowed: string[] = [];
  if (p.mayUseMagic) allowed.push("a little magic");
  if (p.mayTransformTemporarily) allowed.push("temporary transformations");
  if (p.mayPortrayMildDisagreement) allowed.push("mild disagreements");
  if (p.mayPortrayFear) allowed.push("moments of fear");
  if (p.mayUseRealFamilyMembers) allowed.push("real family members");
  if (p.mayInventSchoolOrHomeDetails) allowed.push("invented school/home");
  return allowed;
}

export default async function CharacterDetailPage({
  params,
}: {
  params: Promise<{ characterId: string }>;
}) {
  const { characterId } = await params;
  const actor = await actorOrRedirect();
  const { queries } = await getCharacterServices();
  const profile = await queries.getCharacterProfile(actor, characterId);

  if (!profile) notFound();

  const ni = profile.narrativeIdentity;
  const allowed = policyLines(profile);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-5 py-8">
      <Link
        href="/app/characters"
        className="font-sans text-sm font-medium text-accent"
      >
        ← Characters
      </Link>

      <header className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h1 className="font-display text-3xl font-semibold text-ink text-balance">
            {profile.displayName}
          </h1>
          <StatusBadge status={profile.status} />
        </div>
        <p className="font-sans text-base text-ink-soft">
          Seems about {profile.apparentAge} · {profile.pronouns.join(", ")}
        </p>
      </header>

      {profile.status === "draft" ? (
        <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
          <p className="font-sans text-base text-ink text-pretty">
            Have a read through. When they feel right, approve them so they can
            appear in stories.
          </p>
          <form action={approveCharacterProfileAction}>
            <input type="hidden" name="characterId" value={profile.id} />
            <Button type="submit" size="lg" fullWidth>
              Approve this character
            </Button>
          </form>
          <Link
            href={`/app/characters/${profile.id}/edit`}
            className={buttonClassName({
              variant: "secondary",
              fullWidth: true,
            })}
          >
            Keep editing
          </Link>
        </section>
      ) : (
        <section className="flex flex-col gap-3">
          <Link
            href={`/app/characters/${profile.id}/edit`}
            className={buttonClassName({
              variant: "secondary",
              fullWidth: true,
            })}
          >
            Edit character
          </Link>
          {profile.status === "active" ? (
            <form action={retireCharacterProfileAction}>
              <input type="hidden" name="characterId" value={profile.id} />
              <Button type="submit" variant="ghost" fullWidth>
                Retire from new stories
              </Button>
            </form>
          ) : null}
        </section>
      )}

      <section className="flex flex-col gap-5">
        {ni.personalityTraits.length > 0 ? (
          <div className="flex flex-col gap-3">
            <h2 className="font-display text-xl font-semibold text-ink">
              Personality
            </h2>
            {ni.personalityTraits.map((trait, i) => (
              <div
                key={i}
                className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-3"
              >
                <p className="font-sans text-base font-medium text-ink">
                  {trait.name}
                </p>
                <p className="font-sans text-sm text-ink-soft text-pretty">
                  {trait.description}
                </p>
              </div>
            ))}
          </div>
        ) : null}

        <FactList title="Strengths" items={ni.strengths} />
        <FactList title="Tender spots" items={ni.vulnerabilities} />
        <FactList title="Interests" items={ni.interests} />
        <FactList title="Values" items={ni.values} />

        <div className="flex flex-col gap-1.5">
          <h3 className="font-sans text-sm font-medium text-ink-muted">
            How they speak
          </h3>
          <p className="font-sans text-base text-ink">
            {ni.speechStyle.sentenceLength} sentences ·{" "}
            {ni.speechStyle.directness}
          </p>
        </div>

        <FactList title="Stories may include" items={allowed} />
        <FactList
          title="Kept out"
          items={profile.fictionalisationPolicy.excludedThemes}
        />
      </section>
    </main>
  );
}
