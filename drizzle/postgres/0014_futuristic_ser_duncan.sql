UPDATE "seasons" SET "status" = 'not_started' WHERE "status" NOT IN ('not_started', 'in_progress', 'voting', 'finished', 'paused');--> statement-breakpoint
CREATE UNIQUE INDEX "teams_id_season_unique" ON "teams" USING btree ("id","season_id");--> statement-breakpoint
ALTER TABLE "team_scores" ADD CONSTRAINT "team_scores_team_season_fk" FOREIGN KEY ("team_id","season_id") REFERENCES "public"."teams"("id","season_id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_status_check" CHECK ("seasons"."status" IN ('not_started', 'in_progress', 'voting', 'finished', 'paused'));
