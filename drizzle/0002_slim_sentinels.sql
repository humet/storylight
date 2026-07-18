CREATE TYPE "public"."reference_view" AS ENUM('front-portrait', 'three-quarter', 'full-body-front', 'side-view', 'expression', 'default-outfit');--> statement-breakpoint
CREATE TYPE "public"."visual_asset_state" AS ENUM('quarantined', 'approved', 'rejected', 'retired', 'deletion-pending');--> statement-breakpoint
CREATE TABLE "character_reference_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"visual_profile_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"view" "reference_view" NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "character_reference_assets_profile_view_unq" UNIQUE("visual_profile_id","view")
);
--> statement-breakpoint
CREATE TABLE "visual_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	"candidate_set_id" uuid NOT NULL,
	"view" "reference_view" NOT NULL,
	"state" "visual_asset_state" DEFAULT 'quarantined' NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"checksum" text NOT NULL,
	"byte_size" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"model" text NOT NULL,
	"seed" integer NOT NULL,
	"visual_profile_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	CONSTRAINT "visual_assets_key_unq" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "visual_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"art_bible_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visual_profiles_character_version_unq" UNIQUE("character_id","version")
);
--> statement-breakpoint
ALTER TABLE "child_characters" ADD COLUMN "visual_profile_id" uuid;--> statement-breakpoint
ALTER TABLE "character_reference_assets" ADD CONSTRAINT "character_reference_assets_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_reference_assets" ADD CONSTRAINT "character_reference_assets_visual_profile_id_visual_profiles_id_fk" FOREIGN KEY ("visual_profile_id") REFERENCES "public"."visual_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_reference_assets" ADD CONSTRAINT "character_reference_assets_asset_id_visual_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."visual_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visual_assets" ADD CONSTRAINT "visual_assets_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visual_assets" ADD CONSTRAINT "visual_assets_character_id_child_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."child_characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visual_assets" ADD CONSTRAINT "visual_assets_visual_profile_id_visual_profiles_id_fk" FOREIGN KEY ("visual_profile_id") REFERENCES "public"."visual_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visual_profiles" ADD CONSTRAINT "visual_profiles_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visual_profiles" ADD CONSTRAINT "visual_profiles_character_id_child_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."child_characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "character_reference_assets_profile_idx" ON "character_reference_assets" USING btree ("visual_profile_id");--> statement-breakpoint
CREATE INDEX "visual_assets_family_idx" ON "visual_assets" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "visual_assets_character_state_idx" ON "visual_assets" USING btree ("character_id","state");--> statement-breakpoint
CREATE INDEX "visual_assets_candidate_set_idx" ON "visual_assets" USING btree ("candidate_set_id");--> statement-breakpoint
CREATE INDEX "visual_profiles_character_idx" ON "visual_profiles" USING btree ("character_id");--> statement-breakpoint
ALTER TABLE "child_characters" ADD CONSTRAINT "child_characters_visual_profile_id_visual_profiles_id_fk" FOREIGN KEY ("visual_profile_id") REFERENCES "public"."visual_profiles"("id") ON DELETE set null ON UPDATE no action;