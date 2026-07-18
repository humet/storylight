import type { Metadata } from "next";
import Link from "next/link";

import { actorOrRedirect } from "../guard";
import { CharacterEditor } from "../CharacterEditor";

export const metadata: Metadata = {
  title: "Add a character — Storylight",
};

export const dynamic = "force-dynamic";

export default async function NewCharacterPage() {
  await actorOrRedirect();

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-5 py-8">
      <Link
        href="/app/characters"
        className="font-sans text-sm font-medium text-accent"
      >
        ← Characters
      </Link>
      <CharacterEditor mode="create" />
    </main>
  );
}
