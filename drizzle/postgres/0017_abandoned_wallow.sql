ALTER TABLE "peer_voting_scores" ADD COLUMN "team_id" integer;--> statement-breakpoint
UPDATE "peer_voting_scores" p
SET "team_id" = u."team_id"
FROM "users" u
WHERE p."user_id" = u."id" AND p."team_id" IS NULL;--> statement-breakpoint
ALTER TABLE "peer_voting_scores" ADD CONSTRAINT "peer_voting_scores_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "peer_voting_scores_team" ON "peer_voting_scores" USING btree ("team_id");