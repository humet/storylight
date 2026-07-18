CREATE TYPE "public"."illustration_asset_state" AS ENUM('quarantined', 'approved', 'rejected', 'retired');--> statement-breakpoint
CREATE TYPE "public"."illustration_state" AS ENUM('pending', 'approved', 'manual-review', 'failed');--> statement-breakpoint
CREATE TYPE "public"."image_capability" AS ENUM('character-reference-generation', 'style-reference-generation', 'routine-chapter-illustration', 'premium-chapter-illustration', 'illustration-repair');--> statement-breakpoint
CREATE TABLE "illustration_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"story_id" uuid NOT NULL,
	"chapter_id" uuid NOT NULL,
	"chapter_revision_id" uuid NOT NULL,
	"spec_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"phase" text,
	"original_asset_id" uuid,
	"variant_width" integer,
	"state" "illustration_asset_state" DEFAULT 'quarantined' NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"checksum" text NOT NULL,
	"byte_size" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"model" text NOT NULL,
	"seed" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	CONSTRAINT "illustration_assets_key_unq" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "illustration_publications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"story_id" uuid NOT NULL,
	"spec_id" uuid NOT NULL,
	"state" "illustration_state" DEFAULT 'pending' NOT NULL,
	"revision_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "illustration_publications_spec_unq" UNIQUE("spec_id")
);
--> statement-breakpoint
CREATE TABLE "illustration_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"spec_id" uuid NOT NULL,
	"workflow_id" uuid,
	"phase" text NOT NULL,
	"verdict" jsonb NOT NULL,
	"decision" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "illustration_reviews_spec_workflow_phase_unq" UNIQUE("spec_id","workflow_id","phase")
);
--> statement-breakpoint
CREATE TABLE "illustration_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"story_id" uuid NOT NULL,
	"chapter_id" uuid NOT NULL,
	"chapter_revision_id" uuid NOT NULL,
	"spec_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"original_asset_id" uuid NOT NULL,
	"model" text NOT NULL,
	"art_bible_version" text NOT NULL,
	"image_route_version" text NOT NULL,
	"request_snapshot" jsonb NOT NULL,
	"verdict_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "illustration_revisions_spec_revision_unq" UNIQUE("spec_id","revision_number")
);
--> statement-breakpoint
CREATE TABLE "image_generation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid,
	"story_id" uuid,
	"spec_id" uuid,
	"workflow_id" uuid,
	"stage_key" text,
	"capability" "image_capability" NOT NULL,
	"phase" text NOT NULL,
	"kind" text NOT NULL,
	"target" text NOT NULL,
	"resolved_model_id" text NOT NULL,
	"route_version" text NOT NULL,
	"seed" integer,
	"outcome" text NOT NULL,
	"failure_kind" text,
	"image_count" integer DEFAULT 0 NOT NULL,
	"estimated_cost_minor_units" integer NOT NULL,
	"latency_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "image_generation_runs_workflow_stage_phase_kind_unq" UNIQUE("workflow_id","stage_key","phase","kind")
);
--> statement-breakpoint
ALTER TABLE "illustration_specs" ADD COLUMN "subject_character_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "illustration_specs" ADD COLUMN "prominent_character_id" uuid;--> statement-breakpoint
ALTER TABLE "illustration_assets" ADD CONSTRAINT "illustration_assets_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "illustration_assets" ADD CONSTRAINT "illustration_assets_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "illustration_assets" ADD CONSTRAINT "illustration_assets_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "illustration_assets" ADD CONSTRAINT "illustration_assets_chapter_revision_id_chapter_revisions_id_fk" FOREIGN KEY ("chapter_revision_id") REFERENCES "public"."chapter_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "illustration_assets" ADD CONSTRAINT "illustration_assets_spec_id_illustration_specs_id_fk" FOREIGN KEY ("spec_id") REFERENCES "public"."illustration_specs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "illustration_assets" ADD CONSTRAINT "illustration_assets_original_asset_id_illustration_assets_id_fk" FOREIGN KEY ("original_asset_id") REFERENCES "public"."illustration_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "illustration_publications" ADD CONSTRAINT "illustration_publications_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "illustration_publications" ADD CONSTRAINT "illustration_publications_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "illustration_publications" ADD CONSTRAINT "illustration_publications_spec_id_illustration_specs_id_fk" FOREIGN KEY ("spec_id") REFERENCES "public"."illustration_specs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "illustration_publications" ADD CONSTRAINT "illustration_publications_revision_id_illustration_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."illustration_revisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "illustration_reviews" ADD CONSTRAINT "illustration_reviews_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "illustration_reviews" ADD CONSTRAINT "illustration_reviews_spec_id_illustration_specs_id_fk" FOREIGN KEY ("spec_id") REFERENCES "public"."illustration_specs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "illustration_revisions" ADD CONSTRAINT "illustration_revisions_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "illustration_revisions" ADD CONSTRAINT "illustration_revisions_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "illustration_revisions" ADD CONSTRAINT "illustration_revisions_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "illustration_revisions" ADD CONSTRAINT "illustration_revisions_chapter_revision_id_chapter_revisions_id_fk" FOREIGN KEY ("chapter_revision_id") REFERENCES "public"."chapter_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "illustration_revisions" ADD CONSTRAINT "illustration_revisions_spec_id_illustration_specs_id_fk" FOREIGN KEY ("spec_id") REFERENCES "public"."illustration_specs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "illustration_revisions" ADD CONSTRAINT "illustration_revisions_original_asset_id_illustration_assets_id_fk" FOREIGN KEY ("original_asset_id") REFERENCES "public"."illustration_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_generation_runs" ADD CONSTRAINT "image_generation_runs_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_generation_runs" ADD CONSTRAINT "image_generation_runs_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_generation_runs" ADD CONSTRAINT "image_generation_runs_spec_id_illustration_specs_id_fk" FOREIGN KEY ("spec_id") REFERENCES "public"."illustration_specs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "illustration_assets_spec_state_idx" ON "illustration_assets" USING btree ("spec_id","state");--> statement-breakpoint
CREATE INDEX "illustration_assets_original_idx" ON "illustration_assets" USING btree ("original_asset_id");--> statement-breakpoint
CREATE INDEX "illustration_assets_family_idx" ON "illustration_assets" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "illustration_publications_story_idx" ON "illustration_publications" USING btree ("story_id");--> statement-breakpoint
CREATE INDEX "illustration_reviews_spec_idx" ON "illustration_reviews" USING btree ("spec_id");--> statement-breakpoint
CREATE INDEX "illustration_revisions_spec_idx" ON "illustration_revisions" USING btree ("spec_id");--> statement-breakpoint
CREATE INDEX "image_generation_runs_spec_idx" ON "image_generation_runs" USING btree ("spec_id");--> statement-breakpoint
CREATE INDEX "image_generation_runs_capability_idx" ON "image_generation_runs" USING btree ("capability");