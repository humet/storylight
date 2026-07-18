import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import type { ReferenceView } from "@/domain/reference-view";
import { childCharacters } from "./characters";
import { families } from "./families";

/**
 * Visual character-identity tables (`docs/03-ai/image-generation.md`,
 * `docs/05-backend/storage.md`, ADR-003). All FAMILY-SCOPED. Image BYTES live in
 * private object storage — never here (AGENTS.md: "Store image bytes in Postgres"
 * is forbidden); these tables hold only records, keys, and lineage.
 *
 *  - `visual_profiles`          — an immutable approved visual-identity VERSION
 *                                 for a character (advancing re-approval mints a
 *                                 new row; existing rows are never mutated).
 *  - `visual_assets`            — one stored image (a candidate or an approved
 *                                 reference), with its private storage key,
 *                                 checksum, and lifecycle state.
 *  - `character_reference_assets` — the ordered approved reference SET linking a
 *                                 visual-profile version to its assets.
 *
 * The character's CURRENT approved profile is pointed to by
 * `child_characters.visual_profile_id` (added in `./characters.ts`) — a lifecycle
 * pointer on the mutable identity row, so approving a visual profile never
 * mutates an immutable narrative version (domain rule 5).
 */

/** Asset lifecycle (`docs/05-backend/storage.md` "Asset states"). */
export const visualAssetState = pgEnum("visual_asset_state", [
  "quarantined",
  "approved",
  "rejected",
  "retired",
  "deletion-pending",
]);

/** Canonical reference views (`docs/03-ai/image-generation.md`). */
export const referenceViewEnum = pgEnum("reference_view", [
  "front-portrait",
  "three-quarter",
  "full-body-front",
  "side-view",
  "expression",
  "default-outfit",
]);

export const visualProfiles = pgTable(
  "visual_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    characterId: uuid("character_id")
      .notNull()
      .references(() => childCharacters.id, { onDelete: "cascade" }),
    /** Monotonic per-character version — immutable once minted. */
    version: integer("version").notNull(),
    /** The pinned Art Bible / style version this profile was approved under. */
    artBibleVersion: text("art_bible_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    approvedAt: timestamp("approved_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("visual_profiles_character_version_unq").on(
      table.characterId,
      table.version,
    ),
    index("visual_profiles_character_idx").on(table.characterId),
  ],
);

export const visualAssets = pgTable(
  "visual_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    characterId: uuid("character_id")
      .notNull()
      .references(() => childCharacters.id, { onDelete: "cascade" }),
    /** Groups the assets generated together in one candidate set. */
    candidateSetId: uuid("candidate_set_id").notNull(),
    view: referenceViewEnum("view").$type<ReferenceView>().notNull(),
    state: visualAssetState("state").notNull().default("quarantined"),
    /** Private object-store key — internal only, never exposed to clients. */
    storageKey: text("storage_key").notNull(),
    contentType: text("content_type").notNull(),
    checksum: text("checksum").notNull(),
    byteSize: integer("byte_size").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    model: text("model").notNull(),
    seed: integer("seed").notNull(),
    /** Set when approved into a visual-profile version. */
    visualProfileId: uuid("visual_profile_id").references(
      () => visualProfiles.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (table) => [
    index("visual_assets_family_idx").on(table.familyId),
    // The delivery/review filters are (character, state) and (set) lookups.
    index("visual_assets_character_state_idx").on(
      table.characterId,
      table.state,
    ),
    index("visual_assets_candidate_set_idx").on(table.candidateSetId),
    unique("visual_assets_key_unq").on(table.storageKey),
  ],
);

export const characterReferenceAssets = pgTable(
  "character_reference_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    visualProfileId: uuid("visual_profile_id")
      .notNull()
      .references(() => visualProfiles.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => visualAssets.id, { onDelete: "cascade" }),
    view: referenceViewEnum("view").$type<ReferenceView>().notNull(),
    position: integer("position").notNull(),
  },
  (table) => [
    // One approved asset per view within a visual-profile version.
    unique("character_reference_assets_profile_view_unq").on(
      table.visualProfileId,
      table.view,
    ),
    index("character_reference_assets_profile_idx").on(table.visualProfileId),
  ],
);
