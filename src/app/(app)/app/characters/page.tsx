import type { Metadata } from "next";
import Link from "next/link";

import { buttonClassName, CharacterCard, EmptyState } from "@/components";
import { actorOrRedirect } from "./guard";
import { getCharacterServices } from "./service";

export const metadata: Metadata = {
  title: "Characters — Storylight",
};

// Per-request: characters are resolved from the session's family on every load.
export const dynamic = "force-dynamic";

export default async function CharactersPage() {
  const actor = await actorOrRedirect();
  const { queries } = await getCharacterServices();
  const characters = await queries.getCharacterProfiles(actor);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-8 px-5 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-semibold text-ink text-balance">
          Who appears in your stories
        </h1>
        <p className="font-sans text-base text-ink-soft text-pretty">
          The people your family adventures are built around. Add a character
          once, and they stay recognisable across every story.
        </p>
      </header>

      {characters.length === 0 ? (
        <EmptyState
          title="No characters yet"
          description="Add your first character so tonight's story has a hero to follow."
          action={
            <Link
              href="/app/characters/new"
              className={buttonClassName({ size: "lg", fullWidth: true })}
            >
              Add a character
            </Link>
          }
        />
      ) : (
        <>
          <ul className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
            {characters.map((character) => (
              <li key={character.id}>
                <CharacterCard
                  displayName={character.displayName}
                  status={character.status}
                  apparentAge={character.apparentAge}
                  traitCount={character.traitCount}
                  href={`/app/characters/${character.id}`}
                />
              </li>
            ))}
          </ul>

          <Link
            href="/app/characters/new"
            className={buttonClassName({
              variant: "secondary",
              className: "self-start",
            })}
          >
            Add another character
          </Link>
        </>
      )}
    </main>
  );
}
