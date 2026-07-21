--> ADR-009: per-series image-route pinning (rule 8). Add the pinned image-route
--> version to the series pins so a chapter illustration's GENERATION tiers resolve
--> against the version active when the series began, not whatever is active later.
--> Additive + backfill-safe: add the column NULLABLE, backfill every existing series
--> to the CURRENT active version, then enforce NOT NULL. Existing series are
--> disposable TEST data on the shared Neon DB and 'mvp-image-routes-v2' is exactly
--> the routine/repair route they'd resolve today, so backfilling them to v2 changes
--> nothing observable; it simply makes the pin explicit and rule-8-honest going
--> forward. The UPDATE is guarded by IS NULL so a re-run is idempotent (mirrors how
--> prior migrations appended ON CONFLICT DO NOTHING seeds). On an empty database
--> (db:validate) the UPDATE touches zero rows and SET NOT NULL succeeds trivially.
ALTER TABLE "series_bibles" ADD COLUMN "pinned_image_route_version" text;--> statement-breakpoint
UPDATE "series_bibles" SET "pinned_image_route_version" = 'mvp-image-routes-v2' WHERE "pinned_image_route_version" IS NULL;--> statement-breakpoint
ALTER TABLE "series_bibles" ALTER COLUMN "pinned_image_route_version" SET NOT NULL;
