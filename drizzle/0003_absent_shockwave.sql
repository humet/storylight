CREATE TYPE "public"."workflow_status" AS ENUM('queued', 'running', 'waiting', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "workflow_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"workflow_type" text NOT NULL,
	"status" "workflow_status" DEFAULT 'queued' NOT NULL,
	"request_id" text NOT NULL,
	"entity_id" uuid,
	"current_stage" text NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"input" jsonb NOT NULL,
	"last_error" jsonb,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_executions_user_request_type_unq" UNIQUE("user_id","request_id","workflow_type")
);
--> statement-breakpoint
CREATE TABLE "workflow_stage_outputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"stage_key" text NOT NULL,
	"output" jsonb NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"prompt_version" text,
	"schema_version" text,
	"model_route_version" text,
	"usage" jsonb,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_stage_outputs_workflow_stage_unq" UNIQUE("workflow_id","stage_key")
);
--> statement-breakpoint
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_stage_outputs" ADD CONSTRAINT "workflow_stage_outputs_workflow_id_workflow_executions_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_executions_family_idx" ON "workflow_executions" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "workflow_executions_entity_idx" ON "workflow_executions" USING btree ("family_id","workflow_type","entity_id");--> statement-breakpoint
CREATE INDEX "workflow_stage_outputs_workflow_idx" ON "workflow_stage_outputs" USING btree ("workflow_id");