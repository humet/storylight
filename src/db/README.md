# src/db

Drizzle schema, migrations, repositories, and query services (arrives in Milestone 2).

Boundary rules:

- All schema changes via committed Drizzle migrations; migrations run as an explicit step (`pnpm db:migrate`), never on app startup.
- Queries live in repositories or query services — components never touch the DB directly.
- Transactions are explicit; DB constraints back up application checks (e.g. the documented UNIQUE constraints), not the other way round.
- Large binaries (image bytes) never go in Postgres — object storage only.
