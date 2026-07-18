/**
 * WORLD PROFILE (`docs/02-storytelling/world-building.md`). A world provides
 * familiarity, rules, recurring places, and visual consistency. It may be
 * story-local (one series) or a reusable family world (returns across stories
 * after approval).
 *
 * MVP scope (M8): series use a STORY-LOCAL world whose rules + locations are part
 * of the accepted Series Bible (see `series-bible.ts`). This interface is the
 * canonical world-profile shape for the reusable-family-world path (a later
 * milestone persists `world_profiles`); it is defined here so the bible's world
 * section and continuity's location ids share one vocabulary. Pure types only.
 */

export interface WorldRule {
  key: string;
  /** Clear, narratively useful, testable rule text. */
  statement: string;
}

export interface LocationProfile {
  /** Semantic location key (continuity `locationId`). Never a database id. */
  key: string;
  name: string;
  purpose: string;
  fixedFeatures: string[];
  atmosphere: string;
}

export interface WorldProfile {
  id: string;
  familyId: string;
  key: string;
  name: string;
  version: number;
  status: "draft" | "active" | "retired";

  premise: string;
  rules: WorldRule[];
  locations: LocationProfile[];
  recurringCharacters: string[];
  recurringObjects: string[];
  visualProfileId?: string;
}
