"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  Button,
  SegmentedChoice,
  TextArea,
  TextField,
  ToggleField,
} from "@/components";
import type {
  CharacterProfile,
  CharacterProfilePayload,
} from "@/domain/character";
import {
  createCharacterProfileAction,
  updateCharacterProfileAction,
} from "./actions";

/**
 * The mobile-first parent character editor: a set of short, progressive steps
 * (`docs/01-product/mobile-first.md` — no long multi-column forms). Each step is
 * one calm decision; free-text lists are one idea per line. On the last step the
 * parent reviews, then creates the character as a draft — approval happens on the
 * character's own surface (draft → active).
 *
 * Client Component: it holds the in-progress draft in local state (preserving
 * input across steps) and submits the assembled, typed payload through a thin
 * Server Action. All authorisation and validation happen on the server.
 */

type TraitDraft = {
  name: string;
  description: string;
  behaviouralSignals: string;
  overuseRisks: string;
};

interface EditorState {
  displayName: string;
  apparentAge: string;
  pronouns: string;
  traits: TraitDraft[];
  strengths: string;
  vulnerabilities: string;
  interests: string;
  values: string;
  sentenceLength: "short" | "mixed" | "long";
  directness: "direct" | "reflective" | "playful";
  humourStyle: string;
  vocabularyNotes: string;
  prohibitedPatterns: string;
  behaviourRules: string;
  forbiddenCharacterisations: string;
  mayUseMagic: boolean;
  mayTransformTemporarily: boolean;
  mayPortrayMildDisagreement: boolean;
  mayPortrayFear: boolean;
  mayUseRealFamilyMembers: boolean;
  mayInventSchoolOrHomeDetails: boolean;
  excludedThemes: string;
}

function toLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function toPronouns(value: string): string[] {
  return value
    .split(/[,/\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function emptyState(): EditorState {
  return {
    displayName: "",
    apparentAge: "",
    pronouns: "they, them",
    traits: [],
    strengths: "",
    vulnerabilities: "",
    interests: "",
    values: "",
    sentenceLength: "mixed",
    directness: "reflective",
    humourStyle: "",
    vocabularyNotes: "",
    prohibitedPatterns: "",
    behaviourRules: "",
    forbiddenCharacterisations: "",
    mayUseMagic: true,
    mayTransformTemporarily: true,
    mayPortrayMildDisagreement: true,
    mayPortrayFear: true,
    mayUseRealFamilyMembers: false,
    mayInventSchoolOrHomeDetails: false,
    excludedThemes: "",
  };
}

function fromProfile(profile: CharacterProfile): EditorState {
  const ni = profile.narrativeIdentity;
  return {
    displayName: profile.displayName,
    apparentAge: String(profile.apparentAge),
    pronouns: profile.pronouns.join(", "),
    traits: ni.personalityTraits.map((trait) => ({
      name: trait.name,
      description: trait.description,
      behaviouralSignals: trait.behaviouralSignals.join("\n"),
      overuseRisks: trait.overuseRisks.join("\n"),
    })),
    strengths: ni.strengths.join("\n"),
    vulnerabilities: ni.vulnerabilities.join("\n"),
    interests: ni.interests.join("\n"),
    values: ni.values.join("\n"),
    sentenceLength: ni.speechStyle.sentenceLength,
    directness: ni.speechStyle.directness,
    humourStyle: ni.speechStyle.humourStyle.join("\n"),
    vocabularyNotes: ni.speechStyle.vocabularyNotes.join("\n"),
    prohibitedPatterns: ni.speechStyle.prohibitedPatterns.join("\n"),
    behaviourRules: ni.behaviourRules.join("\n"),
    forbiddenCharacterisations: ni.forbiddenCharacterisations.join("\n"),
    mayUseMagic: profile.fictionalisationPolicy.mayUseMagic,
    mayTransformTemporarily:
      profile.fictionalisationPolicy.mayTransformTemporarily,
    mayPortrayMildDisagreement:
      profile.fictionalisationPolicy.mayPortrayMildDisagreement,
    mayPortrayFear: profile.fictionalisationPolicy.mayPortrayFear,
    mayUseRealFamilyMembers:
      profile.fictionalisationPolicy.mayUseRealFamilyMembers,
    mayInventSchoolOrHomeDetails:
      profile.fictionalisationPolicy.mayInventSchoolOrHomeDetails,
    excludedThemes: profile.fictionalisationPolicy.excludedThemes.join("\n"),
  };
}

function buildPayload(state: EditorState): CharacterProfilePayload {
  return {
    displayName: state.displayName.trim(),
    apparentAge: Number.parseInt(state.apparentAge, 10),
    pronouns: toPronouns(state.pronouns),
    narrativeIdentity: {
      personalityTraits: state.traits
        .filter((trait) => trait.name.trim() && trait.description.trim())
        .map((trait) => ({
          name: trait.name.trim(),
          description: trait.description.trim(),
          behaviouralSignals: toLines(trait.behaviouralSignals),
          overuseRisks: toLines(trait.overuseRisks),
        })),
      strengths: toLines(state.strengths),
      vulnerabilities: toLines(state.vulnerabilities),
      interests: toLines(state.interests),
      values: toLines(state.values),
      speechStyle: {
        sentenceLength: state.sentenceLength,
        directness: state.directness,
        humourStyle: toLines(state.humourStyle),
        vocabularyNotes: toLines(state.vocabularyNotes),
        prohibitedPatterns: toLines(state.prohibitedPatterns),
      },
      behaviourRules: toLines(state.behaviourRules),
      forbiddenCharacterisations: toLines(state.forbiddenCharacterisations),
    },
    fictionalisationPolicy: {
      mayUseMagic: state.mayUseMagic,
      mayTransformTemporarily: state.mayTransformTemporarily,
      mayPortrayMildDisagreement: state.mayPortrayMildDisagreement,
      mayPortrayFear: state.mayPortrayFear,
      mayUseRealFamilyMembers: state.mayUseRealFamilyMembers,
      mayInventSchoolOrHomeDetails: state.mayInventSchoolOrHomeDetails,
      excludedThemes: toLines(state.excludedThemes),
    },
    visualProfileId: null,
  };
}

const STEP_TITLES = [
  "The basics",
  "Personality",
  "How they speak",
  "What stories may change",
  "Review",
] as const;

export interface CharacterEditorProps {
  mode: "create" | "edit";
  /** Present in edit mode: the profile being changed. */
  initial?: CharacterProfile;
}

export function CharacterEditor({ mode, initial }: CharacterEditorProps) {
  const router = useRouter();
  const [state, setState] = useState<EditorState>(() =>
    initial ? fromProfile(initial) : emptyState(),
  );
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const lastStep = STEP_TITLES.length - 1;
  const ageValid = Number.isFinite(Number.parseInt(state.apparentAge, 10));
  const basicsValid = state.displayName.trim().length > 0 && ageValid;

  function set<K extends keyof EditorState>(key: K, value: EditorState[K]) {
    setState((prev) => ({ ...prev, [key]: value }));
  }

  function addTrait() {
    setState((prev) => ({
      ...prev,
      traits: [
        ...prev.traits,
        { name: "", description: "", behaviouralSignals: "", overuseRisks: "" },
      ],
    }));
  }

  function updateTrait(index: number, patch: Partial<TraitDraft>) {
    setState((prev) => ({
      ...prev,
      traits: prev.traits.map((trait, i) =>
        i === index ? { ...trait, ...patch } : trait,
      ),
    }));
  }

  function removeTrait(index: number) {
    setState((prev) => ({
      ...prev,
      traits: prev.traits.filter((_, i) => i !== index),
    }));
  }

  function submit() {
    setError(null);
    const payload = buildPayload(state);
    startTransition(async () => {
      const result =
        mode === "create"
          ? await createCharacterProfileAction(payload)
          : await updateCharacterProfileAction({
              characterId: initial!.id,
              payload,
            });
      if (result.ok) {
        router.push(`/app/characters/${result.id}`);
      } else {
        setError(result.error.message);
      }
    });
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <header className="flex flex-col gap-1">
        <p className="font-sans text-sm font-medium text-ink-muted">
          Step {step + 1} of {STEP_TITLES.length}
        </p>
        <h1 className="font-display text-2xl font-semibold text-ink text-balance">
          {STEP_TITLES[step]}
        </h1>
      </header>

      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-danger-soft px-4 py-3 font-sans text-sm text-danger"
        >
          {error}
        </p>
      ) : null}

      {step === 0 ? (
        <section className="flex flex-col gap-5">
          <TextField
            label="Name"
            value={state.displayName}
            onChange={(e) => set("displayName", e.target.value)}
            placeholder="Rosa"
            autoComplete="off"
            required
          />
          <TextField
            label="About how old do they seem?"
            type="number"
            inputMode="numeric"
            min={0}
            max={120}
            value={state.apparentAge}
            onChange={(e) => set("apparentAge", e.target.value)}
            hint="A rough age band is plenty."
            required
          />
          <TextField
            label="Pronouns"
            value={state.pronouns}
            onChange={(e) => set("pronouns", e.target.value)}
            hint="Separated by commas, e.g. she, her."
          />
        </section>
      ) : null}

      {step === 1 ? (
        <section className="flex flex-col gap-6">
          <div className="flex flex-col gap-4">
            <p className="font-sans text-sm text-ink-soft text-pretty">
              Describe how a trait shows up, not just a label. Little signals
              help the writer picture them.
            </p>
            {state.traits.map((trait, index) => (
              <div
                key={index}
                className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4"
              >
                <TextField
                  label="Trait"
                  value={trait.name}
                  onChange={(e) => updateTrait(index, { name: e.target.value })}
                  placeholder="Meticulous"
                />
                <TextArea
                  label="What does it look like?"
                  value={trait.description}
                  onChange={(e) =>
                    updateTrait(index, { description: e.target.value })
                  }
                  placeholder="Notices small details others miss."
                />
                <TextArea
                  label="Signs of it (one per line)"
                  value={trait.behaviouralSignals}
                  onChange={(e) =>
                    updateTrait(index, { behaviouralSignals: e.target.value })
                  }
                />
                <TextArea
                  label="Don't overdo (one per line)"
                  value={trait.overuseRisks}
                  onChange={(e) =>
                    updateTrait(index, { overuseRisks: e.target.value })
                  }
                />
                <Button
                  variant="ghost"
                  onClick={() => removeTrait(index)}
                  className="self-start"
                >
                  Remove trait
                </Button>
              </div>
            ))}
            <Button variant="secondary" onClick={addTrait}>
              Add a trait
            </Button>
          </div>

          <TextArea
            label="Strengths (one per line)"
            value={state.strengths}
            onChange={(e) => set("strengths", e.target.value)}
          />
          <TextArea
            label="Tender spots (one per line)"
            value={state.vulnerabilities}
            onChange={(e) => set("vulnerabilities", e.target.value)}
            hint="Normal wobbles, never things to fix or shame."
          />
          <TextArea
            label="Interests (one per line)"
            value={state.interests}
            onChange={(e) => set("interests", e.target.value)}
          />
          <TextArea
            label="Values (one per line)"
            value={state.values}
            onChange={(e) => set("values", e.target.value)}
          />
        </section>
      ) : null}

      {step === 2 ? (
        <section className="flex flex-col gap-6">
          <SegmentedChoice
            label="Sentence length"
            value={state.sentenceLength}
            onValueChange={(v) => set("sentenceLength", v)}
            options={[
              { value: "short", label: "Short" },
              { value: "mixed", label: "Mixed" },
              { value: "long", label: "Long" },
            ]}
          />
          <SegmentedChoice
            label="Way of speaking"
            value={state.directness}
            onValueChange={(v) => set("directness", v)}
            options={[
              { value: "direct", label: "Direct" },
              { value: "reflective", label: "Reflective" },
              { value: "playful", label: "Playful" },
            ]}
          />
          <TextArea
            label="Humour (one per line)"
            value={state.humourStyle}
            onChange={(e) => set("humourStyle", e.target.value)}
          />
          <TextArea
            label="Words they'd use (one per line)"
            value={state.vocabularyNotes}
            onChange={(e) => set("vocabularyNotes", e.target.value)}
          />
          <TextArea
            label="Patterns to avoid (one per line)"
            value={state.prohibitedPatterns}
            onChange={(e) => set("prohibitedPatterns", e.target.value)}
            hint="No forced catchphrases — repetition quickly feels false."
          />
        </section>
      ) : null}

      {step === 3 ? (
        <section className="flex flex-col gap-4">
          <ToggleField
            label="A little magic is welcome"
            description="Gentle, wondrous magic may appear."
            checked={state.mayUseMagic}
            onCheckedChange={(v) => set("mayUseMagic", v)}
          />
          <ToggleField
            label="Temporary transformations"
            description="They might briefly become something else, then return."
            checked={state.mayTransformTemporarily}
            onCheckedChange={(v) => set("mayTransformTemporarily", v)}
          />
          <ToggleField
            label="Mild disagreements"
            description="Small, resolvable friction between characters."
            checked={state.mayPortrayMildDisagreement}
            onCheckedChange={(v) => set("mayPortrayMildDisagreement", v)}
          />
          <ToggleField
            label="Moments of fear"
            description="Gentle, age-appropriate worry that passes."
            checked={state.mayPortrayFear}
            onCheckedChange={(v) => set("mayPortrayFear", v)}
          />
          <ToggleField
            label="Include real family members"
            description="Only people you choose to bring in."
            checked={state.mayUseRealFamilyMembers}
            onCheckedChange={(v) => set("mayUseRealFamilyMembers", v)}
          />
          <ToggleField
            label="Invent school or home details"
            description="Otherwise stories won't guess private, real-world facts."
            checked={state.mayInventSchoolOrHomeDetails}
            onCheckedChange={(v) => set("mayInventSchoolOrHomeDetails", v)}
          />
          <TextArea
            label="Themes to keep out (one per line)"
            value={state.excludedThemes}
            onChange={(e) => set("excludedThemes", e.target.value)}
          />
          <TextArea
            label="Ground rules (one per line)"
            value={state.behaviourRules}
            onChange={(e) => set("behaviourRules", e.target.value)}
            hint="How they should always be written."
          />
          <TextArea
            label="Never portray as (one per line)"
            value={state.forbiddenCharacterisations}
            onChange={(e) => set("forbiddenCharacterisations", e.target.value)}
          />
        </section>
      ) : null}

      {step === lastStep ? (
        <section className="flex flex-col gap-3">
          <dl className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
            <div className="flex justify-between gap-4">
              <dt className="font-sans text-sm text-ink-muted">Name</dt>
              <dd className="font-sans text-base font-medium text-ink">
                {state.displayName || "—"}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="font-sans text-sm text-ink-muted">Seems about</dt>
              <dd className="font-sans text-base text-ink">
                {state.apparentAge || "—"}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="font-sans text-sm text-ink-muted">Traits</dt>
              <dd className="font-sans text-base text-ink">
                {
                  state.traits.filter(
                    (t) => t.name.trim() && t.description.trim(),
                  ).length
                }
              </dd>
            </div>
          </dl>
          <p className="font-sans text-sm text-ink-soft text-pretty">
            {mode === "create"
              ? "You'll be able to review everything and approve them on the next screen."
              : "Saving keeps a new version of this character."}
          </p>
        </section>
      ) : null}

      <nav className="mt-2 flex items-center justify-between gap-3">
        {step > 0 ? (
          <Button
            variant="secondary"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={pending}
          >
            Back
          </Button>
        ) : (
          <span />
        )}

        {step < lastStep ? (
          <Button
            onClick={() => setStep((s) => Math.min(lastStep, s + 1))}
            disabled={step === 0 && !basicsValid}
          >
            Next
          </Button>
        ) : (
          <Button onClick={submit} disabled={pending || !basicsValid}>
            {pending
              ? "Saving…"
              : mode === "create"
                ? "Create character"
                : "Save changes"}
          </Button>
        )}
      </nav>
    </div>
  );
}
