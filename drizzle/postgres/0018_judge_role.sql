ALTER TABLE "users" ADD COLUMN "is_judge" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_is_judge_check" CHECK ("users"."is_judge" IN (0, 1));