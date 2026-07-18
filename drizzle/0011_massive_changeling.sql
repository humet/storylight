CREATE TABLE "family_deletion_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"workflow_id" uuid,
	"step" text NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "family_deletion_audit_family_step_unq" UNIQUE("family_id","step")
);
--> statement-breakpoint
ALTER TABLE "families" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "family_deletion_audit_family_idx" ON "family_deletion_audit" USING btree ("family_id");