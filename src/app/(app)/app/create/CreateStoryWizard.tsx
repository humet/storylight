"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Button, SegmentedChoice, TextArea, cn } from "@/components";
import { createOneOffStoryAction, createSeriesAction } from "./actions";

/**
 * The five-step mobile create flow (`docs/04-frontend/mobile-ux.md` "Create
 * flow": idea → characters → format → optional parent choices → start). One
 * Client Component holds the whole draft so input is preserved across steps
 * (mobile-ux "Preserve draft input"; accessibility "show one major decision at a
 * time"). On start it calls the thin Server Action and navigates to the progress
 * screen — the durable workflow keeps running if the parent leaves.
 */

interface WizardCharacter {
  id: string;
  displayName: string;
  apparentAge: number;
  traitCount: number;
}

type Length = "short" | "standard" | "long";
type Tone = "gentle" | "playful" | "adventurous" | "cosy";
type Format = "one_off" | "series";
type ChapterCount = 5 | 10;

const STEP_LABELS = ["Idea", "Characters", "Format", "Choices", "Start"];

export function CreateStoryWizard({
  characters,
}: {
  characters: WizardCharacter[];
}) {
  const router = useRouter();
  // Stable idempotency key for this attempt — a double submit dedupes.
  const requestId = useRef(globalThis.crypto.randomUUID());

  const [step, setStep] = useState(0);
  const [idea, setIdea] = useState("");
  const [selected, setSelected] = useState<string[]>(
    characters.length === 1 ? [characters[0].id] : [],
  );
  const [length, setLength] = useState<Length>("standard");
  const [tone, setTone] = useState<Tone>("gentle");
  const [format, setFormat] = useState<Format>("one_off");
  const [chapterCount, setChapterCount] = useState<ChapterCount>(5);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canContinue = useMemo(() => {
    if (step === 0) return idea.trim().length > 0;
    if (step === 1) return selected.length > 0;
    return true;
  }, [step, idea, selected]);

  function toggleCharacter(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function start() {
    setSubmitting(true);
    setError(null);
    if (format === "series") {
      const result = await createSeriesAction({
        requestId: requestId.current,
        idea: idea.trim(),
        characterIds: selected,
        length,
        tone,
        theme: null,
        chapterCount,
      });
      if (result.ok) {
        router.push(`/app/series/${result.storyId}/progress`);
        return;
      }
      setSubmitting(false);
      setError(result.error.message);
      return;
    }
    const result = await createOneOffStoryAction({
      requestId: requestId.current,
      idea: idea.trim(),
      characterIds: selected,
      length,
      tone,
      theme: null,
    });
    if (result.ok) {
      router.push(`/app/stories/${result.storyId}/progress`);
      return;
    }
    setSubmitting(false);
    setError(result.error.message);
  }

  return (
    <div className="flex flex-1 flex-col gap-8">
      <ol className="flex items-center gap-2" aria-label="Progress">
        {STEP_LABELS.map((label, index) => (
          <li key={label} className="flex flex-1 flex-col gap-1">
            <span
              aria-hidden
              className={cn(
                "h-1 rounded-full",
                index <= step ? "bg-accent" : "bg-border",
              )}
            />
            <span className="sr-only">
              Step {index + 1}: {label}
              {index === step ? " (current)" : ""}
            </span>
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <section className="flex flex-col gap-4">
          <h1 className="font-display text-3xl font-semibold text-ink text-balance">
            What should tonight&rsquo;s story be about?
          </h1>
          <TextArea
            label="Your idea"
            value={idea}
            onChange={(event) => setIdea(event.target.value)}
            rows={5}
            maxLength={500}
            placeholder="A brave little fox who is scared of the dark…"
          />
        </section>
      ) : null}

      {step === 1 ? (
        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="font-display text-2xl font-semibold text-ink text-balance">
              Who is in tonight&rsquo;s story?
            </h1>
            <p className="font-sans text-sm text-ink-soft text-pretty">
              Choose one or more. Tap again to remove.
            </p>
          </div>
          <ul className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
            {characters.map((character) => {
              const isSelected = selected.includes(character.id);
              return (
                <li key={character.id}>
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => toggleCharacter(character.id)}
                    className={cn(
                      "flex min-h-[var(--touch-min)] w-full flex-col gap-1 rounded-xl border p-4 text-left",
                      "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-standard)]",
                      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
                      isSelected
                        ? "border-accent-strong bg-accent-soft"
                        : "border-border bg-surface",
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-display text-lg font-semibold text-ink">
                        {character.displayName}
                      </span>
                      <span
                        aria-hidden
                        className={cn(
                          "flex size-6 items-center justify-center rounded-full border text-sm",
                          isSelected
                            ? "border-accent-strong bg-accent-strong text-on-accent"
                            : "border-border-strong text-transparent",
                        )}
                      >
                        ✓
                      </span>
                    </span>
                    <span className="font-sans text-sm text-ink-muted">
                      Around {character.apparentAge}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="flex flex-col gap-4">
          <h1 className="font-display text-2xl font-semibold text-ink text-balance">
            How would you like it?
          </h1>
          <div className="flex flex-col gap-3">
            <button
              type="button"
              aria-pressed={format === "one_off"}
              onClick={() => setFormat("one_off")}
              className={cn(
                "rounded-xl border p-4 text-left transition-colors",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
                format === "one_off"
                  ? "border-accent-strong bg-accent-soft"
                  : "border-border bg-surface",
              )}
            >
              <p className="font-display text-lg font-semibold text-ink">
                One story tonight
              </p>
              <p className="font-sans text-sm text-ink-soft text-pretty">
                A complete bedtime story, ready in one reading.
              </p>
            </button>
            <button
              type="button"
              aria-pressed={format === "series"}
              onClick={() => setFormat("series")}
              className={cn(
                "rounded-xl border p-4 text-left transition-colors",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
                format === "series"
                  ? "border-accent-strong bg-accent-soft"
                  : "border-border bg-surface",
              )}
            >
              <p className="font-display text-lg font-semibold text-ink">
                A story to continue
              </p>
              <p className="font-sans text-sm text-ink-soft text-pretty">
                A planned series that grows one gentle chapter each night.
              </p>
            </button>
          </div>
        </section>
      ) : null}

      {step === 3 ? (
        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="font-display text-2xl font-semibold text-ink text-balance">
              A few choices
            </h1>
            <p className="font-sans text-sm text-ink-soft text-pretty">
              Optional — we&rsquo;ll pick calm defaults if you skip ahead.
            </p>
          </div>
          <SegmentedChoice<Length>
            label="Length"
            value={length}
            onValueChange={setLength}
            options={[
              { value: "short", label: "Short", hint: "5–7 min" },
              { value: "standard", label: "Standard", hint: "8–12 min" },
              { value: "long", label: "Long", hint: "12–15 min" },
            ]}
          />
          <SegmentedChoice<Tone>
            label="Tone"
            value={tone}
            onValueChange={setTone}
            options={[
              { value: "gentle", label: "Gentle" },
              { value: "playful", label: "Playful" },
              { value: "cosy", label: "Cosy" },
            ]}
          />
          {format === "series" ? (
            <div className="flex flex-col gap-1.5">
              <span className="font-sans text-sm font-medium text-ink">
                How many nights
              </span>
              <div
                role="radiogroup"
                aria-label="How many nights"
                className="grid grid-cols-2 gap-2"
              >
                {([5, 10] as ChapterCount[]).map((count) => {
                  const selected = chapterCount === count;
                  return (
                    <button
                      key={count}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setChapterCount(count)}
                      className={cn(
                        "flex min-h-[var(--touch-min)] flex-col items-center justify-center gap-0.5 rounded-lg border px-3 py-2 text-center transition-colors",
                        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
                        selected
                          ? "border-accent-strong bg-accent-soft text-ink"
                          : "border-border-strong bg-surface text-ink-soft",
                      )}
                    >
                      <span className="font-sans text-base font-medium">
                        {count} nights
                      </span>
                      <span className="font-sans text-xs text-ink-muted">
                        {count === 5 ? "shorter" : "longer"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {step === 4 ? (
        <section className="flex flex-col gap-4">
          <h1 className="font-display text-2xl font-semibold text-ink text-balance">
            Ready to begin
          </h1>
          <dl className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
            <div className="flex flex-col gap-0.5">
              <dt className="font-sans text-xs font-medium text-ink-muted uppercase">
                Tonight&rsquo;s idea
              </dt>
              <dd className="font-sans text-base text-ink text-pretty">
                {idea.trim()}
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="font-sans text-xs font-medium text-ink-muted uppercase">
                Starring
              </dt>
              <dd className="font-sans text-base text-ink">
                {characters
                  .filter((c) => selected.includes(c.id))
                  .map((c) => c.displayName)
                  .join(", ")}
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="font-sans text-xs font-medium text-ink-muted uppercase">
                Format
              </dt>
              <dd className="font-sans text-base text-ink">
                {format === "series"
                  ? `A series over ${chapterCount} nights`
                  : "One story tonight"}
              </dd>
            </div>
          </dl>
          {error ? (
            <p role="alert" className="font-sans text-sm text-danger">
              {error}
            </p>
          ) : null}
          <Button size="lg" fullWidth onClick={start} disabled={submitting}>
            {submitting
              ? "Starting…"
              : format === "series"
                ? "Begin the series"
                : "Start tonight's story"}
          </Button>
        </section>
      ) : null}

      <div className="mt-auto flex items-center justify-between gap-3 pt-4">
        <Button
          variant="ghost"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0 || submitting}
        >
          Back
        </Button>
        {step < 4 ? (
          <Button
            onClick={() => setStep((s) => Math.min(4, s + 1))}
            disabled={!canContinue}
          >
            Next
          </Button>
        ) : null}
      </div>
    </div>
  );
}
