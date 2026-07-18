import {
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { users } from "./auth";

/**
 * Storylight identity model (`docs/05-backend/auth.md`, `docs/05-backend/database.md`).
 *
 * A `family` is the tenancy boundary: every story, character, and asset belongs
 * to exactly one family, and authorisation is "is this actor a member of THIS
 * family?" — never "does this actor possess an ID?" (`auth.md`). Membership and
 * role live in `family_members`; a user may belong to several families with a
 * distinct role in each.
 *
 * Roles are constrained by a Postgres enum so an invalid role cannot be written
 * even if application code has a bug (AGENTS.md: "Prefer database constraints
 * plus application checks over application checks alone").
 */

/** owner / parent / viewer — the only roles (`docs/05-backend/auth.md` "Roles"). */
export const familyRole = pgEnum("family_role", ["owner", "parent", "viewer"]);

export const families = pgTable("families", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 120 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const familyMembers = pgTable(
  "family_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    // `users.id` is a text column (Better Auth string IDs), so the FK is text.
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: familyRole("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // A user has at most one membership row (one role) per family.
    unique("family_members_family_user_unq").on(table.familyId, table.userId),
  ],
);
