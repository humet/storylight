CREATE TABLE "evaluation_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"route_version_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"approved_by" text NOT NULL,
	"environment" text NOT NULL,
	"note" text,
	"superseded_at" timestamp with time zone,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evaluation_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"route_version_id" uuid,
	"capability" "language_capability",
	"fixture_set_id" text NOT NULL,
	"fixture_set_version" text NOT NULL,
	"environment" text NOT NULL,
	"summary" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "model_route_versions_one_active_per_capability";--> statement-breakpoint
ALTER TABLE "model_route_versions" ADD COLUMN "is_canary" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "model_route_versions" ADD COLUMN "canary_rule" jsonb;--> statement-breakpoint
ALTER TABLE "evaluation_approvals" ADD CONSTRAINT "evaluation_approvals_route_version_id_model_route_versions_id_fk" FOREIGN KEY ("route_version_id") REFERENCES "public"."model_route_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_approvals" ADD CONSTRAINT "evaluation_approvals_report_id_evaluation_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."evaluation_reports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_reports" ADD CONSTRAINT "evaluation_reports_route_version_id_model_route_versions_id_fk" FOREIGN KEY ("route_version_id") REFERENCES "public"."model_route_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "evaluation_approvals_one_live_per_route" ON "evaluation_approvals" USING btree ("route_version_id") WHERE "evaluation_approvals"."superseded_at" is null;--> statement-breakpoint
CREATE INDEX "evaluation_approvals_route_idx" ON "evaluation_approvals" USING btree ("route_version_id");--> statement-breakpoint
CREATE INDEX "evaluation_reports_route_idx" ON "evaluation_reports" USING btree ("route_version_id");--> statement-breakpoint
CREATE INDEX "evaluation_reports_capability_idx" ON "evaluation_reports" USING btree ("capability");--> statement-breakpoint
CREATE UNIQUE INDEX "model_route_versions_one_canary_per_capability" ON "model_route_versions" USING btree ("capability") WHERE "model_route_versions"."lifecycle_status" = 'active' and "model_route_versions"."is_canary" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "model_route_versions_one_active_per_capability" ON "model_route_versions" USING btree ("capability") WHERE "model_route_versions"."lifecycle_status" = 'active' and "model_route_versions"."is_canary" = false;
--> statement-breakpoint
-- M10 evaluation gate seed: the local-fake baseline report + one real
-- evaluation approval per active route, replacing M6's bootstrap approval
-- record so "every active route has an evaluation approval" holds from an
-- empty-then-migrated database. Provenance is honest: environment 'local-fake'.
INSERT INTO "evaluation_reports" ("id","route_version_id","capability","fixture_set_id","fixture_set_version","environment","summary","created_by") VALUES
	('e3268581-ab72-50b7-8c40-d3dd5f901dc6', NULL, NULL, 'storylight-core', '1.0.0', 'local-fake', '{"totalCases":14,"passedCases":14,"blockedCases":0,"blockingCodes":[],"dimensions":[{"dimension":"deterministic","total":21,"passed":21,"passRate":1},{"dimension":"safety","total":5,"passed":5,"passRate":1},{"dimension":"domain-quality","total":8,"passed":8,"passRate":1},{"dimension":"product-experience","total":0,"passed":0,"passRate":null},{"dimension":"cost-latency","total":5,"passed":5,"passRate":1}],"totalCostMinorUnits":5,"p95LatencyMs":5,"failedCaseIds":[]}'::jsonb, 'system:m10-baseline')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "evaluation_approvals" ("id","route_version_id","report_id","approved_by","environment","note","approved_at") VALUES
	('612f188a-e341-501e-81a6-f15d52c39bff', 'b5cefd48-c5c8-5d0f-a81c-c357a9f1dd32', 'e3268581-ab72-50b7-8c40-d3dd5f901dc6', 'owner:storylight', 'local-fake', 'M10 local-fake baseline evaluation; supersedes M6 bootstrap.', '2026-07-18T00:00:00.000Z'),
	('a8cb29e9-6cd9-5e78-b7ba-4148d25227a1', '02a38cf0-3d3f-51c0-83c4-f3ce39ee2778', 'e3268581-ab72-50b7-8c40-d3dd5f901dc6', 'owner:storylight', 'local-fake', 'M10 local-fake baseline evaluation; supersedes M6 bootstrap.', '2026-07-18T00:00:00.000Z'),
	('0fb5d076-8aa1-5e60-9399-eb373aade09e', 'd0ff797a-1ddc-52ff-9a95-796812b5d71f', 'e3268581-ab72-50b7-8c40-d3dd5f901dc6', 'owner:storylight', 'local-fake', 'M10 local-fake baseline evaluation; supersedes M6 bootstrap.', '2026-07-18T00:00:00.000Z'),
	('ecfb5388-b794-517b-a782-423b86c3a0cd', '9a04a6c5-9cb3-51da-b40c-1f17feac5bd9', 'e3268581-ab72-50b7-8c40-d3dd5f901dc6', 'owner:storylight', 'local-fake', 'M10 local-fake baseline evaluation; supersedes M6 bootstrap.', '2026-07-18T00:00:00.000Z'),
	('772ad312-102c-5db2-aae5-6bcc27fd2d8d', '091e716d-93e6-5b7c-aa69-9b09ec1032e1', 'e3268581-ab72-50b7-8c40-d3dd5f901dc6', 'owner:storylight', 'local-fake', 'M10 local-fake baseline evaluation; supersedes M6 bootstrap.', '2026-07-18T00:00:00.000Z'),
	('6afaa42f-abc7-55d0-bec5-a458aa12118e', 'cb558c87-6593-553e-9f24-2de420cb9524', 'e3268581-ab72-50b7-8c40-d3dd5f901dc6', 'owner:storylight', 'local-fake', 'M10 local-fake baseline evaluation; supersedes M6 bootstrap.', '2026-07-18T00:00:00.000Z'),
	('b2d82d01-826f-500d-af7d-50e65d1f76e2', 'dac4a447-9aec-5c02-bbfe-501fd79c9837', 'e3268581-ab72-50b7-8c40-d3dd5f901dc6', 'owner:storylight', 'local-fake', 'M10 local-fake baseline evaluation; supersedes M6 bootstrap.', '2026-07-18T00:00:00.000Z'),
	('d79beb54-33ca-56f3-946e-031f6ecb6638', 'fd4d2bd5-cf23-5ee9-963d-d57268d5e88d', 'e3268581-ab72-50b7-8c40-d3dd5f901dc6', 'owner:storylight', 'local-fake', 'M10 local-fake baseline evaluation; supersedes M6 bootstrap.', '2026-07-18T00:00:00.000Z'),
	('5aecab56-d9ea-56d0-8810-73b935a31782', '461e843a-be7c-5b0e-b092-7a98fb5b1f6e', 'e3268581-ab72-50b7-8c40-d3dd5f901dc6', 'owner:storylight', 'local-fake', 'M10 local-fake baseline evaluation; supersedes M6 bootstrap.', '2026-07-18T00:00:00.000Z')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "model_route_versions" SET "evaluation_profile" = 'storylight-core', "approval_record" = jsonb_build_object('approvedBy','system:m10-evaluation','approvedAt','2026-07-18T00:00:00.000Z','note','Superseded by M10 evaluation approval (local-fake baseline).','evaluationRunId','e3268581-ab72-50b7-8c40-d3dd5f901dc6') WHERE "version" = '1.0.0' AND "lifecycle_status" = 'active';
