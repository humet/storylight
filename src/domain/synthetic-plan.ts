import { invalidCommandError } from "@/lib/errors";
import { nameBasedUuid } from "./name-uuid";

/**
 * The SYNTHETIC PLAN domain artifact + its pure transitions. Paired with the M6
 * synthetic wire schema/prompt, it demonstrates the post-validation half of the
 * structured-output pipeline WITHOUT pre-building M7's real Story-DNA types:
 *  - `crossReferenceSyntheticPlan` rejects unknown references + duplicate keys
 *    (`structured-output.md`: "Unknown references are rejected");
 *  - `normaliseSyntheticPlan` computes the derived beat count (a CANONICAL
 *    CALCULATION the app owns, never the model — `structured-output.md`);
 *  - `validateSyntheticPlan` is the domain-validation gate;
 *  - `assignSyntheticPlanIds` maps local semantic KEYS to application-generated
 *    IDs (`structured-output.md` "IDs": models never generate database ids).
 *
 * All transitions are pure/deterministic (id minting hashes stable inputs), so
 * they live in the domain and are easy to test.
 */

/** A validated wire character/beat (matches `synthetic-plan.schema.ts`). */
export interface SyntheticPlanWireLike {
  schemaVersion: string;
  title: string;
  summary: string;
  characters: { key: string; name: string }[];
  beats: { key: string; characterKey: string; action: string }[];
}

/** Normalised (key-based) plan with the app-computed derived field. */
export interface SyntheticPlan {
  title: string;
  summary: string;
  characters: { key: string; name: string }[];
  beats: { key: string; characterKey: string; action: string }[];
  /** Derived by the app, not the model. */
  beatCount: number;
}

/** The persisted, ID-bearing artifact (keys mapped to app-generated ids). */
export interface SyntheticPlanArtifact {
  schemaVersion: string;
  title: string;
  summary: string;
  characters: { id: string; key: string; name: string }[];
  beats: {
    id: string;
    key: string;
    characterId: string;
    characterKey: string;
    action: string;
  }[];
  beatCount: number;
}

/**
 * Cross-reference validation on the WIRE output. Throws (rejected → the pipeline
 * repairs/regenerates) when a beat references an unknown character key, or when
 * character/beat keys are not unique.
 */
export function crossReferenceSyntheticPlan(wire: SyntheticPlanWireLike): void {
  const characterKeys = new Set<string>();
  for (const c of wire.characters) {
    if (characterKeys.has(c.key)) {
      throw invalidCommandError({
        internalDetail: `Duplicate character key "${c.key}".`,
        stage: "plan.cross-reference",
      });
    }
    characterKeys.add(c.key);
  }

  const beatKeys = new Set<string>();
  for (const b of wire.beats) {
    if (beatKeys.has(b.key)) {
      throw invalidCommandError({
        internalDetail: `Duplicate beat key "${b.key}".`,
        stage: "plan.cross-reference",
      });
    }
    beatKeys.add(b.key);
    if (!characterKeys.has(b.characterKey)) {
      throw invalidCommandError({
        internalDetail: `Beat "${b.key}" references unknown character key "${b.characterKey}".`,
        stage: "plan.cross-reference",
      });
    }
  }
}

/** Pure normalisation: trim + compute the derived beat count. */
export function normaliseSyntheticPlan(
  wire: SyntheticPlanWireLike,
): SyntheticPlan {
  return {
    title: wire.title.trim(),
    summary: wire.summary.trim(),
    characters: wire.characters.map((c) => ({
      key: c.key,
      name: c.name.trim(),
    })),
    beats: wire.beats.map((b) => ({
      key: b.key,
      characterKey: b.characterKey,
      action: b.action.trim(),
    })),
    beatCount: wire.beats.length,
  };
}

/** Domain-validation gate on the normalised plan. Throws on invalid. */
export function validateSyntheticPlan(plan: SyntheticPlan): void {
  if (plan.characters.length < 1) {
    throw invalidCommandError({
      internalDetail: "A plan must have at least one character.",
      stage: "plan.domain",
    });
  }
  if (plan.beatCount < 1 || plan.beatCount > 12) {
    throw invalidCommandError({
      internalDetail: `Beat count ${plan.beatCount} is out of range [1, 12].`,
      stage: "plan.domain",
    });
  }
}

/**
 * Map local semantic keys to APPLICATION-generated ids. Ids are deterministic
 * (`nameBasedUuid` over the workflow/stage correlation + key) so a stage re-run
 * reproduces the same ids — idempotent persistence (the M5 stage contract). The
 * model never sees or generates these ids.
 */
export async function assignSyntheticPlanIds(
  plan: SyntheticPlan,
  correlation: { workflowId: string; stageKey: string },
): Promise<SyntheticPlanArtifact> {
  const { workflowId, stageKey } = correlation;

  const characterIdByKey = new Map<string, string>();
  const characters = await Promise.all(
    plan.characters.map(async (c) => {
      const id = await nameBasedUuid(
        "synthetic-plan-character",
        workflowId,
        stageKey,
        c.key,
      );
      characterIdByKey.set(c.key, id);
      return { id, key: c.key, name: c.name };
    }),
  );

  const beats = await Promise.all(
    plan.beats.map(async (b) => {
      const id = await nameBasedUuid(
        "synthetic-plan-beat",
        workflowId,
        stageKey,
        b.key,
      );
      const characterId = characterIdByKey.get(b.characterKey);
      if (!characterId) {
        // Cross-reference validation runs before this, so this is unreachable —
        // guard defensively rather than emit an undefined id.
        throw invalidCommandError({
          internalDetail: `Beat "${b.key}" references unmapped character key "${b.characterKey}".`,
          stage: "plan.assign-ids",
        });
      }
      return {
        id,
        key: b.key,
        characterId,
        characterKey: b.characterKey,
        action: b.action,
      };
    }),
  );

  return {
    schemaVersion: "synthetic-plan.v1",
    title: plan.title,
    summary: plan.summary,
    characters,
    beats,
    beatCount: plan.beatCount,
  };
}
