CREATE TYPE "public"."language_capability" AS ENUM('one-off-planning', 'series-planning', 'chapter-planning', 'chapter-writing', 'chapter-review', 'chapter-revision', 'continuity-extraction', 'illustration-planning', 'illustration-review');--> statement-breakpoint
CREATE TYPE "public"."route_lifecycle_status" AS ENUM('draft', 'active', 'deprecated', 'retired');--> statement-breakpoint
CREATE TYPE "public"."generation_outcome" AS ENUM('accepted', 'repaired', 'regenerated', 'rejected', 'failed');--> statement-breakpoint
CREATE TYPE "public"."repair_phase" AS ENUM('initial', 'syntax-repair', 'model-repair', 'regenerate');--> statement-breakpoint
CREATE TABLE "model_route_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"capability" "language_capability" NOT NULL,
	"version" text NOT NULL,
	"primary_target" text NOT NULL,
	"fallbacks" jsonb NOT NULL,
	"settings" jsonb NOT NULL,
	"lifecycle_status" "route_lifecycle_status" NOT NULL,
	"evaluation_profile" text,
	"approval_record" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_route_versions_capability_version_unq" UNIQUE("capability","version")
);
--> statement-breakpoint
CREATE TABLE "generation_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid,
	"workflow_id" uuid,
	"stage_key" text,
	"schema_version" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "generation_artifacts_workflow_stage_unq" UNIQUE("workflow_id","stage_key")
);
--> statement-breakpoint
CREATE TABLE "generation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid,
	"workflow_id" uuid,
	"stage_key" text,
	"capability" "language_capability" NOT NULL,
	"model_route_version_id" uuid,
	"route_version" text NOT NULL,
	"resolved_model_id" text NOT NULL,
	"target" text NOT NULL,
	"prompt_version" text NOT NULL,
	"schema_version" text NOT NULL,
	"attempt_index" integer NOT NULL,
	"parent_attempt_index" integer,
	"phase" "repair_phase" NOT NULL,
	"outcome" "generation_outcome" NOT NULL,
	"failure_kind" text,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"total_tokens" integer NOT NULL,
	"estimated_cost_minor_units" integer NOT NULL,
	"latency_ms" integer NOT NULL,
	"artifact_ref" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "generation_runs_workflow_stage_attempt_unq" UNIQUE("workflow_id","stage_key","attempt_index")
);
--> statement-breakpoint
CREATE TABLE "prompt_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purpose" text NOT NULL,
	"version" text NOT NULL,
	"capability" "language_capability" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prompt_versions_purpose_version_unq" UNIQUE("purpose","version")
);
--> statement-breakpoint
CREATE TABLE "schema_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schema_version" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schema_versions_schema_version_unique" UNIQUE("schema_version")
);
--> statement-breakpoint
ALTER TABLE "generation_artifacts" ADD CONSTRAINT "generation_artifacts_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_artifacts" ADD CONSTRAINT "generation_artifacts_workflow_id_workflow_executions_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_workflow_id_workflow_executions_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_model_route_version_id_model_route_versions_id_fk" FOREIGN KEY ("model_route_version_id") REFERENCES "public"."model_route_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_artifact_ref_generation_artifacts_id_fk" FOREIGN KEY ("artifact_ref") REFERENCES "public"."generation_artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "model_route_versions_one_active_per_capability" ON "model_route_versions" USING btree ("capability") WHERE "model_route_versions"."lifecycle_status" = 'active';--> statement-breakpoint
CREATE INDEX "model_route_versions_capability_idx" ON "model_route_versions" USING btree ("capability");--> statement-breakpoint
CREATE INDEX "generation_artifacts_workflow_idx" ON "generation_artifacts" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "generation_runs_workflow_idx" ON "generation_runs" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "generation_runs_capability_idx" ON "generation_runs" USING btree ("capability");
--> statement-breakpoint
--> M6 seed: source-controlled default model routes (mirrors src/application/model-routes/default-model-routes.ts; guarded by default-model-routes DB test).
INSERT INTO "model_route_versions" ("id","capability","version","primary_target","fallbacks","settings","lifecycle_status","evaluation_profile","approval_record") VALUES
	('b5cefd48-c5c8-5d0f-a81c-c357a9f1dd32', 'one-off-planning', '1.0.0', 'anthropic/claude-sonnet-5', '["anthropic/claude-sonnet-4.6"]'::jsonb, '{"temperature":0.6,"maxOutputTokens":4000}'::jsonb, 'active', NULL, '{"approvedBy":"system:m6-seed","approvedAt":"2026-07-18T00:00:00.000Z","note":"M6 bootstrap seed — pending the M10 evaluation gate."}'::jsonb),
	('02a38cf0-3d3f-51c0-83c4-f3ce39ee2778', 'series-planning', '1.0.0', 'anthropic/claude-opus-4.8', '["anthropic/claude-sonnet-5"]'::jsonb, '{"temperature":0.6,"maxOutputTokens":8000}'::jsonb, 'active', NULL, '{"approvedBy":"system:m6-seed","approvedAt":"2026-07-18T00:00:00.000Z","note":"M6 bootstrap seed — pending the M10 evaluation gate."}'::jsonb),
	('d0ff797a-1ddc-52ff-9a95-796812b5d71f', 'chapter-planning', '1.0.0', 'anthropic/claude-sonnet-5', '["anthropic/claude-sonnet-4.6"]'::jsonb, '{"temperature":0.5,"maxOutputTokens":4000}'::jsonb, 'active', NULL, '{"approvedBy":"system:m6-seed","approvedAt":"2026-07-18T00:00:00.000Z","note":"M6 bootstrap seed — pending the M10 evaluation gate."}'::jsonb),
	('9a04a6c5-9cb3-51da-b40c-1f17feac5bd9', 'chapter-writing', '1.0.0', 'anthropic/claude-sonnet-5', '["anthropic/claude-sonnet-4.6"]'::jsonb, '{"temperature":0.8,"maxOutputTokens":8000}'::jsonb, 'active', NULL, '{"approvedBy":"system:m6-seed","approvedAt":"2026-07-18T00:00:00.000Z","note":"M6 bootstrap seed — pending the M10 evaluation gate."}'::jsonb),
	('091e716d-93e6-5b7c-aa69-9b09ec1032e1', 'chapter-review', '1.0.0', 'google/gemini-3.5-flash', '["google/gemini-3.1-flash-lite"]'::jsonb, '{"temperature":0.2,"maxOutputTokens":4000}'::jsonb, 'active', NULL, '{"approvedBy":"system:m6-seed","approvedAt":"2026-07-18T00:00:00.000Z","note":"M6 bootstrap seed — pending the M10 evaluation gate."}'::jsonb),
	('cb558c87-6593-553e-9f24-2de420cb9524', 'chapter-revision', '1.0.0', 'anthropic/claude-sonnet-5', '["anthropic/claude-sonnet-4.6"]'::jsonb, '{"temperature":0.7,"maxOutputTokens":8000}'::jsonb, 'active', NULL, '{"approvedBy":"system:m6-seed","approvedAt":"2026-07-18T00:00:00.000Z","note":"M6 bootstrap seed — pending the M10 evaluation gate."}'::jsonb),
	('dac4a447-9aec-5c02-bbfe-501fd79c9837', 'continuity-extraction', '1.0.0', 'anthropic/claude-haiku-4.5', '["anthropic/claude-sonnet-4.6"]'::jsonb, '{"temperature":0.1,"maxOutputTokens":4000}'::jsonb, 'active', NULL, '{"approvedBy":"system:m6-seed","approvedAt":"2026-07-18T00:00:00.000Z","note":"M6 bootstrap seed — pending the M10 evaluation gate."}'::jsonb),
	('fd4d2bd5-cf23-5ee9-963d-d57268d5e88d', 'illustration-planning', '1.0.0', 'anthropic/claude-sonnet-5', '["anthropic/claude-sonnet-4.6"]'::jsonb, '{"temperature":0.4,"maxOutputTokens":4000}'::jsonb, 'active', NULL, '{"approvedBy":"system:m6-seed","approvedAt":"2026-07-18T00:00:00.000Z","note":"M6 bootstrap seed — pending the M10 evaluation gate."}'::jsonb),
	('461e843a-be7c-5b0e-b092-7a98fb5b1f6e', 'illustration-review', '1.0.0', 'google/gemini-3.5-flash', '["google/gemini-3.1-flash-lite"]'::jsonb, '{"temperature":0.2,"maxOutputTokens":2000}'::jsonb, 'active', NULL, '{"approvedBy":"system:m6-seed","approvedAt":"2026-07-18T00:00:00.000Z","note":"M6 bootstrap seed — pending the M10 evaluation gate."}'::jsonb)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "prompt_versions" ("purpose","version","capability") VALUES
	('synthetic-planning', '1.0.0', 'one-off-planning')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "schema_versions" ("schema_version","name") VALUES
	('synthetic-plan.v1', 'StorylightSyntheticPlan')
ON CONFLICT DO NOTHING;
