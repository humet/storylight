"use server";

import { revalidatePath } from "next/cache";

import { actorOrRedirect } from "../../guard";
import { getStoryServices } from "../service";

/**
 * Parent reader actions (M9, `docs/04-frontend/story-reader.md` "Parent actions":
 * Try another wording, Regenerate an illustration — visually secondary). Thin
 * Server Actions over the story command service; the command authorises + validates.
 * Regeneration runs asynchronously (text-first): the current approved content stays
 * on screen until a new revision supersedes it, so a child never sees a broken page.
 */

/** "Try another wording": re-generate the one-off's text as a new revision. */
export async function regenerateChapterAction(
  formData: FormData,
): Promise<void> {
  const storyId = String(formData.get("storyId") ?? "");
  const actor = await actorOrRedirect();
  const { commands } = await getStoryServices();
  await commands.regenerateChapter(actor, { storyId });
  revalidatePath(`/app/stories/${storyId}`);
}

/** "Repaint the pictures": start a fresh image job for each illustration in the chapter. */
export async function regenerateIllustrationsAction(
  formData: FormData,
): Promise<void> {
  const storyId = String(formData.get("storyId") ?? "");
  const actor = await actorOrRedirect();
  const { commands, queries } = await getStoryServices();
  const reader = await queries.getStoryReader(actor, storyId);
  if (reader) {
    for (const slot of reader.illustrations) {
      await commands.regenerateIllustration(actor, { specId: slot.specId });
    }
  }
  revalidatePath(`/app/stories/${storyId}`);
}
