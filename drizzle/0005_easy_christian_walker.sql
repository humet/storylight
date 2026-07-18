CREATE TYPE "public"."chapter_revision_status" AS ENUM('accepted', 'superseded', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."illustration_aspect" AS ENUM('portrait', 'landscape', 'square');--> statement-breakpoint
CREATE TYPE "public"."reading_age_band" AS ENUM('3-4', '5-7', '8-10');--> statement-breakpoint
CREATE TYPE "public"."story_status" AS ENUM('generating', 'published', 'blocked', 'failed');--> statement-breakpoint
CREATE TYPE "public"."story_type" AS ENUM('one_off', 'series');--> statement-breakpoint
CREATE TYPE "public"."suspense_level" AS ENUM('calm', 'mild', 'adventurous');--> statement-breakpoint
CREATE TABLE "chapter_publications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chapter_id" uuid NOT NULL,
	"story_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chapter_publications_chapter_unq" UNIQUE("chapter_id")
);
--> statement-breakpoint
CREATE TABLE "chapter_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chapter_id" uuid NOT NULL,
	"story_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"status" "chapter_revision_status" DEFAULT 'accepted' NOT NULL,
	"title" varchar(160) NOT NULL,
	"body_paragraphs" jsonb NOT NULL,
	"word_count" integer NOT NULL,
	"schema_version" text NOT NULL,
	"plan_snapshot" jsonb NOT NULL,
	"review_snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chapter_revisions_chapter_revision_unq" UNIQUE("chapter_id","revision_number")
);
--> statement-breakpoint
CREATE TABLE "chapters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"chapter_number" integer DEFAULT 1 NOT NULL,
	"current_revision_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chapters_story_number_unq" UNIQUE("story_id","chapter_number")
);
--> statement-breakpoint
CREATE TABLE "illustration_specs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid NOT NULL,
	"chapter_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"anchor_key" varchar(80) NOT NULL,
	"order_index" integer NOT NULL,
	"after_paragraph" integer NOT NULL,
	"caption" varchar(240) NOT NULL,
	"scene_description" text NOT NULL,
	"aspect" "illustration_aspect" NOT NULL,
	"schema_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "illustration_specs_revision_anchor_unq" UNIQUE("revision_id","anchor_key")
);
--> statement-breakpoint
CREATE TABLE "reading_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"chapter_id" uuid,
	"scroll_proportion" real DEFAULT 0 NOT NULL,
	"paragraph_anchor" integer DEFAULT 0 NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"last_read_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reading_progress_story_user_unq" UNIQUE("story_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "stories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"type" "story_type" DEFAULT 'one_off' NOT NULL,
	"status" "story_status" DEFAULT 'generating' NOT NULL,
	"title" varchar(160),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "story_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"reading_age" "reading_age_band" DEFAULT '5-7' NOT NULL,
	"max_suspense" "suspense_level" DEFAULT 'mild' NOT NULL,
	"allow_mild_peril" boolean DEFAULT true NOT NULL,
	"allow_death_grief" boolean DEFAULT false NOT NULL,
	"allow_real_family_members" boolean DEFAULT false NOT NULL,
	"allow_fictionalise_school_home" boolean DEFAULT true NOT NULL,
	"excluded_topics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "story_preferences_family_unq" UNIQUE("family_id")
);
--> statement-breakpoint
ALTER TABLE "chapter_publications" ADD CONSTRAINT "chapter_publications_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_publications" ADD CONSTRAINT "chapter_publications_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_publications" ADD CONSTRAINT "chapter_publications_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_publications" ADD CONSTRAINT "chapter_publications_revision_id_chapter_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."chapter_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_revisions" ADD CONSTRAINT "chapter_revisions_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_revisions" ADD CONSTRAINT "chapter_revisions_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_revisions" ADD CONSTRAINT "chapter_revisions_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_current_revision_id_chapter_revisions_id_fk" FOREIGN KEY ("current_revision_id") REFERENCES "public"."chapter_revisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "illustration_specs" ADD CONSTRAINT "illustration_specs_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "illustration_specs" ADD CONSTRAINT "illustration_specs_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "illustration_specs" ADD CONSTRAINT "illustration_specs_revision_id_chapter_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."chapter_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "illustration_specs" ADD CONSTRAINT "illustration_specs_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_preferences" ADD CONSTRAINT "story_preferences_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chapter_publications_story_idx" ON "chapter_publications" USING btree ("story_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chapter_revisions_one_accepted_per_chapter" ON "chapter_revisions" USING btree ("chapter_id") WHERE "chapter_revisions"."status" = 'accepted';--> statement-breakpoint
CREATE INDEX "chapter_revisions_chapter_idx" ON "chapter_revisions" USING btree ("chapter_id");--> statement-breakpoint
CREATE INDEX "chapters_story_idx" ON "chapters" USING btree ("story_id");--> statement-breakpoint
CREATE INDEX "illustration_specs_story_idx" ON "illustration_specs" USING btree ("story_id");--> statement-breakpoint
CREATE INDEX "illustration_specs_chapter_idx" ON "illustration_specs" USING btree ("chapter_id");--> statement-breakpoint
CREATE INDEX "reading_progress_family_idx" ON "reading_progress" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "stories_family_idx" ON "stories" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "stories_family_status_idx" ON "stories" USING btree ("family_id","status");--> statement-breakpoint
--> M7 seed: source-controlled published prompt + wire-schema versions (immutable records).
INSERT INTO "prompt_versions" ("purpose","version","capability") VALUES
	('one-off-planning', '1.0.0', 'one-off-planning'),
	('one-off-writing', '1.0.0', 'chapter-writing'),
	('one-off-revision', '1.0.0', 'chapter-revision'),
	('one-off-review', '1.0.0', 'chapter-review'),
	('one-off-illustration', '1.0.0', 'illustration-planning')
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "schema_versions" ("schema_version","name") VALUES
	('one-off-plan.v1', 'StorylightOneOffPlan'),
	('chapter-draft.v1', 'StorylightChapterDraft'),
	('chapter-review.v1', 'StorylightChapterReview'),
	('illustration-plan.v1', 'StorylightIllustrationPlan')
ON CONFLICT DO NOTHING;