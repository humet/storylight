import {
  type AnyPgColumn,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import type {
  FictionalisationPolicy,
  NarrativeIdentity,
} from "@/domain/character";
import { families } from "./families";
import { visualProfiles } from "./visual-assets";

/**
 * Character narrative-profile tables (`docs/02-storytelling/character-system.md`,
 * `docs/05-backend/database.md`). Three tables, all FAMILY-SCOPED so a family is
 * the only tenancy boundary that can reach them:
 *
 *  - `child_characters`         — the stable identity + lifecycle + a pointer to
 *                                 the current profile version.
 *  - `character_profile_versions` — immutable snapshots of the editable payload.
 *                                 A permanent change mints a new row; the
 *                                 character row is repointed at it.
 *  - `character_relationships`  — first-class bonds between two characters.
 *
 * Versioning follows the doc: PERMANENT changes (core traits, speech guidance,
 * fictionalisation boundaries, apparent age, display name, pronouns, appearance
 * notes) create a new version; lifecycle changes (approve/retire) do not. Frequently-queried
 * fields (`status`, `current_version`, `display_name`) are typed columns on the
 * character row for cheap list queries; the rich payloads
 * (`narrative_identity`, `fictionalisation_policy`) are validated JSONB on the
 * version, typed via the domain interfaces (the DB depends on the domain, never
 * the reverse).
 */

/** draft / active / retired — the character lifecycle (`character-system.md`). */
export const characterStatus = pgEnum("character_status", [
  "draft",
  "active",
  "retired",
]);

export const childCharacters = pgTable(
  "child_characters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    /** App-generated semantic key — never a model/user id. */
    characterKey: varchar("character_key", { length: 80 }).notNull(),
    status: characterStatus("status").notNull().default("draft"),
    /** Denormalised from the current version for list queries. */
    displayName: varchar("display_name", { length: 120 }).notNull(),
    /** The current version NUMBER (denormalised) and a FK to the version row. */
    currentVersion: integer("current_version").notNull().default(1),
    currentVersionId: uuid("current_version_id").references(
      // Circular FK (character ↔ version): nullable + set-null on delete so the
      // character can be inserted before its first version exists.
      (): AnyPgColumn => characterProfileVersions.id,
      { onDelete: "set null" },
    ),
    /**
     * The character's CURRENT approved visual profile version (M4). Circular FK
     * with `visual_profiles.character_id` — nullable + set-null on delete so the
     * character exists before any visual profile does, exactly like
     * `current_version_id`. Approving a visual profile repoints this (a lifecycle
     * change on the mutable identity row, never a narrative-version mint).
     */
    visualProfileId: uuid("visual_profile_id").references(
      (): AnyPgColumn => visualProfiles.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
  },
  (table) => [
    // A semantic key is unique WITHIN a family (docs/05-backend/database.md).
    unique("child_characters_family_key_unq").on(
      table.familyId,
      table.characterKey,
    ),
    index("child_characters_family_idx").on(table.familyId),
  ],
);

export const characterProfileVersions = pgTable(
  "character_profile_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    characterId: uuid("character_id")
      .notNull()
      .references(() => childCharacters.id, { onDelete: "cascade" }),
    // Carried for defence-in-depth family scoping on the version table itself.
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    // Snapshot of the editable payload at this version.
    displayName: varchar("display_name", { length: 120 }).notNull(),
    apparentAge: integer("apparent_age").notNull(),
    pronouns: jsonb("pronouns").$type<string[]>().notNull(),
    // Parent-authored physical description (nullable; NULL = no notes). Native
    // length constraint mirrors the domain cap; feeds the anchor reference only.
    appearanceNotes: varchar("appearance_notes", { length: 500 }),
    narrativeIdentity: jsonb("narrative_identity")
      .$type<NarrativeIdentity>()
      .notNull(),
    fictionalisationPolicy: jsonb("fictionalisation_policy")
      .$type<FictionalisationPolicy>()
      .notNull(),
    // Forward pointer to the visual profile (M4); nullable until then.
    visualProfileId: text("visual_profile_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // One row per (character, version) — immutable revision history.
    unique("character_profile_versions_character_version_unq").on(
      table.characterId,
      table.version,
    ),
    index("character_profile_versions_character_idx").on(table.characterId),
  ],
);

export const characterRelationships = pgTable(
  "character_relationships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    fromCharacterId: uuid("from_character_id")
      .notNull()
      .references(() => childCharacters.id, { onDelete: "cascade" }),
    toCharacterId: uuid("to_character_id")
      .notNull()
      .references(() => childCharacters.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 60 }).notNull(),
    baseline: text("baseline").notNull(),
    currentState: text("current_state"),
    boundaries: jsonb("boundaries").$type<string[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // A directed relationship of a given type exists at most once per pair.
    unique("character_relationships_pair_type_unq").on(
      table.fromCharacterId,
      table.toCharacterId,
      table.type,
    ),
    index("character_relationships_family_idx").on(table.familyId),
  ],
);
