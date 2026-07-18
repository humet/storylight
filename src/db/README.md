# src/db

Drizzle schema, migrations, repositories, and query services. The single,
swappable database entry point is `client.ts` (`getDb()`): `pg` (node-postgres)
when `DATABASE_URL` is set; a dev/test-only file-backed PGlite fallback
otherwise. Tests use `testing.ts` (empty → migrated in-memory PGlite).

Boundary rules:

- All schema changes via committed Drizzle migrations (`pnpm db:generate` to
  create, `pnpm db:migrate` to apply). Migrations run as an explicit step, never
  on app startup — the only exception is the dev PGlite fallback, which
  self-migrates locally and is unreachable in production (see BUILD_STATE.md).
- Queries live in repositories that implement application-owned ports
  (`src/application/ports`) — components and domain code never touch the DB.
- Every family-scoped read is filtered by membership, never by ID alone
  (`docs/05-backend/auth.md`).
- Transactions are explicit; DB constraints back up application checks (FKs,
  the `family_role` enum, UNIQUE(family_id, user_id)), not the other way round.
- Drizzle/`pg`/PGlite imports are confined to `src/db/**` and `src/adapters/**`
  (ESLint-enforced). Large binaries (image bytes) never go in Postgres.
