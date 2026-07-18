import type { Metadata } from "next";
import Link from "next/link";

import { actorOrRedirect } from "../../guard";
import { getStoryServices } from "../../stories/service";
import { SettingsForm } from "./SettingsForm";

export const metadata: Metadata = {
  title: "Story settings — Storylight",
};

export const dynamic = "force-dynamic";

export default async function ParentSettingsPage() {
  const actor = await actorOrRedirect();
  const { queries } = await getStoryServices();
  const preferences = await queries.getStoryPreferences(actor);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-8 px-5 py-10">
      <div className="flex flex-col gap-2">
        <Link href="/app" className="font-sans text-sm font-medium text-accent">
          ← Home
        </Link>
        <h1 className="font-display text-3xl font-semibold text-ink text-balance">
          Story settings
        </h1>
        <p className="font-sans text-base text-ink-soft text-pretty">
          These keep every story right for your family. They flow through
          planning, writing, and review.
        </p>
      </div>

      <SettingsForm initial={preferences} />
    </main>
  );
}
