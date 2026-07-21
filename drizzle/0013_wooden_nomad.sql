ALTER TABLE "illustration_specs" ADD COLUMN "wardrobe_state_key" varchar(64);--> statement-breakpoint
ALTER TABLE "illustration_specs" ADD COLUMN "wardrobe_appearance" varchar(200);--> statement-breakpoint
--> ADR-008 part 2 seed: source-controlled published prompt + wire-schema versions (immutable records).
--> The illustration-plan schema bumps to v3 (adds optional plan-level wardrobeStates + a per-scene
--> wardrobe state-key reference) and the one-off-illustration prompt bumps to 1.2.0 (instructs the
--> model to declare + reference wardrobe states). v1/v2 / 1.0.0/1.1.0 remain as immutable published
--> records. INSERTs are not schema, so db:check stays green.
INSERT INTO "schema_versions" ("schema_version","name") VALUES
	('illustration-plan.v3', 'StorylightIllustrationPlan')
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "prompt_versions" ("purpose","version","capability") VALUES
	('one-off-illustration', '1.2.0', 'illustration-planning')
ON CONFLICT DO NOTHING;