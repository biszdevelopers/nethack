ALTER TABLE "oauth2_applications" DROP CONSTRAINT "oauth2_applications_client_id_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "idx_seasons_one_active" ON "seasons" USING btree ("is_active") WHERE "seasons"."is_active" = 1;--> statement-breakpoint
CREATE INDEX "teams_season_submitted" ON "teams" USING btree ("season_id","project_submitted");