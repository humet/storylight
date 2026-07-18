"use client";

import { useState } from "react";

import { Button, SegmentedChoice, ToggleField } from "@/components";
import type { StoryPreferences } from "@/application/ports/story-repository";
import { updateStoryPreferencesAction } from "./actions";

type ReadingAge = "3-4" | "5-7" | "8-10";
type Suspense = "calm" | "mild" | "adventurous";

/**
 * Parent safety settings form (`docs/02-storytelling/safety-age-appropriateness.md`
 * "Parent configuration"). A parent surface — denser than child-facing screens but
 * still mobile-friendly, and visually secondary in the product. Parents may only
 * make things STRICTER; core child-safety rules are enforced by the review policy
 * regardless of these choices.
 */
export function SettingsForm({ initial }: { initial: StoryPreferences }) {
  const [readingAge, setReadingAge] = useState<ReadingAge>(initial.readingAge);
  const [maxSuspense, setMaxSuspense] = useState<Suspense>(initial.maxSuspense);
  const [allowMildPeril, setAllowMildPeril] = useState(initial.allowMildPeril);
  const [allowDeathGrief, setAllowDeathGrief] = useState(
    initial.allowDeathGrief,
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setSaved(false);
    setError(null);
    const result = await updateStoryPreferencesAction({
      readingAge,
      maxSuspense,
      allowMildPeril,
      allowDeathGrief,
    });
    setSaving(false);
    if (result.ok) setSaved(true);
    else setError(result.error.message);
  }

  return (
    <div className="flex flex-col gap-6">
      <SegmentedChoice<ReadingAge>
        label="Reading age"
        value={readingAge}
        onValueChange={setReadingAge}
        hint="Shapes the vocabulary and the length of tonight's story."
        options={[
          { value: "3-4", label: "3–4" },
          { value: "5-7", label: "5–7" },
          { value: "8-10", label: "8–10" },
        ]}
      />

      <SegmentedChoice<Suspense>
        label="Most suspense allowed"
        value={maxSuspense}
        onValueChange={setMaxSuspense}
        hint="Stories never exceed this, and may be gentler."
        options={[
          { value: "calm", label: "Calm" },
          { value: "mild", label: "Mild" },
          { value: "adventurous", label: "Adventurous" },
        ]}
      />

      <div className="flex flex-col gap-3">
        <ToggleField
          label="Allow mild peril"
          description="Bounded, resolved danger — a wobble on a bridge, a lost mitten."
          checked={allowMildPeril}
          onCheckedChange={setAllowMildPeril}
        />
        <ToggleField
          label="Allow death or grief themes"
          description="Off by default. Turn on only if your family is ready for them."
          checked={allowDeathGrief}
          onCheckedChange={setAllowDeathGrief}
        />
      </div>

      {error ? (
        <p role="alert" className="font-sans text-sm text-danger">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="font-sans text-sm text-success">
          Saved.
        </p>
      ) : null}

      <Button size="lg" fullWidth onClick={save} disabled={saving}>
        {saving ? "Saving…" : "Save settings"}
      </Button>
    </div>
  );
}
