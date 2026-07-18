CREATE TYPE "public"."character_status" AS ENUM('draft', 'active', 'retired');--> statement-breakpoint
CREATE TABLE "character_profile_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"apparent_age" integer NOT NULL,
	"pronouns" jsonb NOT NULL,
	"narrative_identity" jsonb NOT NULL,
	"fictionalisation_policy" jsonb NOT NULL,
	"visual_profile_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_profile_versions_character_version_unq" UNIQUE("character_id","version")
);
--> statement-breakpoint
CREATE TABLE "character_relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"from_character_id" uuid NOT NULL,
	"to_character_id" uuid NOT NULL,
	"type" varchar(60) NOT NULL,
	"baseline" text NOT NULL,
	"current_state" text,
	"boundaries" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_relationships_pair_type_unq" UNIQUE("from_character_id","to_character_id","type")
);
--> statement-breakpoint
CREATE TABLE "child_characters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"character_key" varchar(80) NOT NULL,
	"status" character_status DEFAULT 'draft' NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"current_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	CONSTRAINT "child_characters_family_key_unq" UNIQUE("family_id","character_key")
);
--> statement-breakpoint
ALTER TABLE "character_profile_versions" ADD CONSTRAINT "character_profile_versions_character_id_child_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."child_characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_profile_versions" ADD CONSTRAINT "character_profile_versions_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_relationships" ADD CONSTRAINT "character_relationships_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_relationships" ADD CONSTRAINT "character_relationships_from_character_id_child_characters_id_fk" FOREIGN KEY ("from_character_id") REFERENCES "public"."child_characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_relationships" ADD CONSTRAINT "character_relationships_to_character_id_child_characters_id_fk" FOREIGN KEY ("to_character_id") REFERENCES "public"."child_characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "child_characters" ADD CONSTRAINT "child_characters_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "child_characters" ADD CONSTRAINT "child_characters_current_version_id_character_profile_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."character_profile_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "character_profile_versions_character_idx" ON "character_profile_versions" USING btree ("character_id");--> statement-breakpoint
CREATE INDEX "character_relationships_family_idx" ON "character_relationships" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "child_characters_family_idx" ON "child_characters" USING btree ("family_id");