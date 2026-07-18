import type { GenerationOutcome } from "@/domain/generation-run";

/**
 * READ PORT for accepted-result COST reporting (`docs/06-engineering/cost-management.md`).
 * The impl (`src/db/repositories/cost-repository.ts`) sums EVERY recorded attempt
 * — initial generation, schema repair, revision, regeneration, image repair, and
 * premium escalation — so a cheap-but-failure-prone route cannot look artificially
 * inexpensive (retries are counted). Text runs are attributed to a story via the
 * workflow's `entity_id` (all story/chapter workflows act on the story id); image
 * runs carry `story_id` directly.
 */

/** Text cost broken down by generation outcome (accepted incl. its retries). */
export type TextCostByOutcome = Record<GenerationOutcome, number>;

/** Image cost broken down by ladder phase. */
export interface ImageCostByPhase {
  initial: number;
  repair: number;
  escalation: number;
}

export interface StoryCostReport {
  storyId: string;
  textCostMinorUnits: number;
  imageCostMinorUnits: number;
  totalMinorUnits: number;
  textAttempts: number;
  imageAttempts: number;
  textByOutcome: TextCostByOutcome;
  imageByPhase: ImageCostByPhase;
  /**
   * The portion of cost spent on retries/repair/escalation (NOT the first clean
   * result) — the number that a naive "accepted attempt only" view would hide.
   */
  retryCostMinorUnits: number;
}

export interface CostRepository {
  /** Full accepted-result cost breakdown for one story (family-scoped). */
  storyCost(familyId: string, storyId: string): Promise<StoryCostReport>;
}
