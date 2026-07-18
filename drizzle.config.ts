import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit configuration (ADR-005). Build tooling, not app runtime — it runs
 * from the CLI (`pnpm db:generate`, `pnpm db:migrate`), so reading
 * `process.env` directly here is appropriate.
 *
 * `generate` and `check` never open a connection (they diff the schema against
 * committed SQL), so the URL fallback below is only ever used by `migrate`/
 * `push`, which a developer runs against a real `DATABASE_URL`. Migrations are
 * an explicit, controlled step — never run implicitly from app startup
 * (`docs/05-backend/database.md`).
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://localhost:5432/storylight",
  },
  strict: true,
  verbose: true,
});
