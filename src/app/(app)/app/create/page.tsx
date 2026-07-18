import type { Metadata } from "next";
import Link from "next/link";

import { buttonClassName, EmptyState } from "@/components";
import { actorOrRedirect } from "../guard";
import { getStoryServices } from "../stories/service";
import { CreateStoryWizard } from "./CreateStoryWizard";

export const metadata: Metadata = {
  title: "New adventure — Storylight",
};

// Per-request: characters are resolved from the session's family on every load.
export const dynamic = "force-dynamic";

export default async function CreateStoryPage() {
  const actor = await actorOrRedirect();
  const { queries } = await getStoryServices();
  const characters = await queries.getActiveCharacters(actor);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-8 px-5 py-8">
      {characters.length === 0 ? (
        <>
          <header className="flex flex-col gap-2">
            <h1 className="font-display text-3xl font-semibold text-ink text-balance">
              What should tonight&rsquo;s story be about?
            </h1>
          </header>
          <EmptyState
            title="First, add someone to the story"
            description="Every adventure needs a hero. Add a character, then come back to write tonight's story."
            action={
              <Link
                href="/app/characters/new"
                className={buttonClassName({ size: "lg", fullWidth: true })}
              >
                Add a character
              </Link>
            }
          />
        </>
      ) : (
        <CreateStoryWizard
          characters={characters.map((c) => ({
            id: c.id,
            displayName: c.displayName,
            apparentAge: c.apparentAge,
            traitCount: c.traitCount,
          }))}
        />
      )}
    </main>
  );
}
