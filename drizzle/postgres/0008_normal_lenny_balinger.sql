CREATE TABLE "team_invites" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"email" text NOT NULL,
	"invited_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "peer_voting_scores_user_id_unique";--> statement-breakpoint
ALTER TABLE "peer_voting_scores" ADD COLUMN "season_id" integer;--> statement-breakpoint
UPDATE "peer_voting_scores"
SET "season_id" = COALESCE(
    (SELECT "id" FROM "seasons" WHERE "is_active" = 1 LIMIT 1),
    (SELECT MIN("id") FROM "seasons")
)
WHERE "season_id" IS NULL;--> statement-breakpoint
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "peer_voting_scores" WHERE "season_id" IS NULL) THEN
        RAISE EXCEPTION 'peer_voting_scores contains votes but no season can be assigned; create or restore a season before upgrading';
    END IF;
END $$;--> statement-breakpoint
ALTER TABLE "peer_voting_scores" ALTER COLUMN "season_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "team_invites" ADD CONSTRAINT "team_invites_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_invites" ADD CONSTRAINT "team_invites_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "team_invites_team_email" ON "team_invites" USING btree ("team_id","email");--> statement-breakpoint
CREATE INDEX "team_invites_email" ON "team_invites" USING btree ("email");--> statement-breakpoint
ALTER TABLE "peer_voting_scores" ADD CONSTRAINT "peer_voting_scores_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "peer_voting_scores_user_season_unique" ON "peer_voting_scores" USING btree ("user_id","season_id");
