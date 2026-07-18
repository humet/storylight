ALTER TABLE "reading_progress" DROP CONSTRAINT "reading_progress_story_user_unq";--> statement-breakpoint
ALTER TABLE "reading_progress" DROP CONSTRAINT "reading_progress_chapter_id_chapters_id_fk";
--> statement-breakpoint
ALTER TABLE "reading_progress" ALTER COLUMN "chapter_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_story_chapter_user_unq" UNIQUE("story_id","chapter_id","user_id");