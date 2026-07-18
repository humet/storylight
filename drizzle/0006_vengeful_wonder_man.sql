CREATE TYPE "public"."plot_thread_status" AS ENUM('planned', 'introduced', 'developing', 'resolved');--> statement-breakpoint
CREATE TABLE "chapter_blueprints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"chapter_number" integer NOT NULL,
	"blueprint" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chapter_blueprints_story_chapter_unq" UNIQUE("story_id","chapter_number")
);
--> statement-breakpoint
CREATE TABLE "continuity_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"after_chapter_number" integer NOT NULL,
	"state" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "continuity_snapshots_story_chapter_unq" UNIQUE("story_id","after_chapter_number")
);
--> statement-breakpoint
CREATE TABLE "plot_thread_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"thread_key" varchar(80) NOT NULL,
	"chapter_number" integer NOT NULL,
	"status" "plot_thread_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plot_thread_states_story_key_chapter_unq" UNIQUE("story_id","thread_key","chapter_number")
);
--> statement-breakpoint
CREATE TABLE "plot_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"thread_key" varchar(80) NOT NULL,
	"description" text NOT NULL,
	"introduce_in_chapter" integer NOT NULL,
	"resolve_in_chapter" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plot_threads_story_key_unq" UNIQUE("story_id","thread_key")
);
--> statement-breakpoint
CREATE TABLE "series_bibles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"schema_version" text NOT NULL,
	"title" varchar(160) NOT NULL,
	"spoiler_free_premise" text NOT NULL,
	"chapter_count" integer NOT NULL,
	"bible" jsonb NOT NULL,
	"story_dna" jsonb NOT NULL,
	"pinned_route_profile" jsonb NOT NULL,
	"pinned_prompt_versions" jsonb NOT NULL,
	"pinned_schema_versions" jsonb NOT NULL,
	"pinned_visual_profiles" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "series_bibles_story_unq" UNIQUE("story_id")
);
--> statement-breakpoint
ALTER TABLE "chapter_blueprints" ADD CONSTRAINT "chapter_blueprints_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_blueprints" ADD CONSTRAINT "chapter_blueprints_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "continuity_snapshots" ADD CONSTRAINT "continuity_snapshots_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "continuity_snapshots" ADD CONSTRAINT "continuity_snapshots_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plot_thread_states" ADD CONSTRAINT "plot_thread_states_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plot_thread_states" ADD CONSTRAINT "plot_thread_states_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plot_threads" ADD CONSTRAINT "plot_threads_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plot_threads" ADD CONSTRAINT "plot_threads_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_bibles" ADD CONSTRAINT "series_bibles_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_bibles" ADD CONSTRAINT "series_bibles_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chapter_blueprints_story_idx" ON "chapter_blueprints" USING btree ("story_id");--> statement-breakpoint
CREATE INDEX "continuity_snapshots_story_idx" ON "continuity_snapshots" USING btree ("story_id");--> statement-breakpoint
CREATE INDEX "plot_thread_states_story_idx" ON "plot_thread_states" USING btree ("story_id");--> statement-breakpoint
CREATE INDEX "plot_threads_story_idx" ON "plot_threads" USING btree ("story_id");--> statement-breakpoint
CREATE INDEX "series_bibles_family_idx" ON "series_bibles" USING btree ("family_id");--> statement-breakpoint
--> M8 seed: source-controlled published prompt + wire-schema versions (immutable records).
INSERT INTO "prompt_versions" ("purpose","version","capability") VALUES
	('series-planning', '1.0.0', 'series-planning'),
	('chapter-planning', '1.0.0', 'chapter-planning'),
	('chapter-writing', '1.0.0', 'chapter-writing'),
	('chapter-revision', '1.0.0', 'chapter-revision'),
	('continuity-extraction', '1.0.0', 'continuity-extraction')
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "schema_versions" ("schema_version","name") VALUES
	('series-bible.v1', 'StorylightSeriesBible'),
	('chapter-plan.v1', 'StorylightChapterPlan'),
	('continuity-change.v1', 'StorylightContinuityChange')
ON CONFLICT DO NOTHING;