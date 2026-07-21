CREATE TYPE "public"."illustration_time_of_day" AS ENUM('day', 'dawn', 'dusk', 'night');--> statement-breakpoint
ALTER TABLE "illustration_specs" ADD COLUMN "companions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "illustration_specs" ADD COLUMN "setting_location" varchar(120);--> statement-breakpoint
ALTER TABLE "illustration_specs" ADD COLUMN "setting_time_of_day" "illustration_time_of_day";--> statement-breakpoint
--> ADR-008 seed: source-controlled published prompt + wire-schema versions (immutable records).
--> The illustration-plan schema bumps to v2 (adds optional companions + setting) and the
--> one-off-illustration prompt bumps to 1.1.0 (instructs the model to declare them). v1 / 1.0.0
--> remain as immutable published records. INSERTs are not schema, so db:check stays green.
INSERT INTO "schema_versions" ("schema_version","name") VALUES
	('illustration-plan.v2', 'StorylightIllustrationPlan')
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "prompt_versions" ("purpose","version","capability") VALUES
	('one-off-illustration', '1.1.0', 'illustration-planning')
ON CONFLICT DO NOTHING;