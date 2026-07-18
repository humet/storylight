import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CharacterEditor } from "../../CharacterEditor";
import { actorOrRedirect } from "../../guard";
import { getCharacterServices } from "../../service";

export const metadata: Metadata = {
  title: "Edit character — Storylight",
};

export const dynamic = "force-dynamic";

export default async function EditCharacterPage({
  params,
}: {
  params: Promise<{ characterId: string }>;
}) {
  const { characterId } = await params;
  const actor = await actorOrRedirect();
  const { queries } = await getCharacterServices();
  const profile = await queries.getCharacterProfile(actor, characterId);

  if (!profile) notFound();

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-5 py-8">
      <Link
        href={`/app/characters/${profile.id}`}
        className="font-sans text-sm font-medium text-accent"
      >
        ← Back
      </Link>
      <CharacterEditor mode="edit" initial={profile} />
    </main>
  );
}
