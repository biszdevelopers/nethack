CREATE TABLE "judge_flags" (
	"id" serial PRIMARY KEY NOT NULL,
	"season_id" integer NOT NULL,
	"team_id" integer NOT NULL,
	"judge_user_id" integer NOT NULL,
	"reason" text NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "seasons" ADD COLUMN "max_team_members" integer DEFAULT 6 NOT NULL;--> statement-breakpoint
ALTER TABLE "team_invites" ADD COLUMN "token" text;--> statement-breakpoint
ALTER TABLE "team_invites" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
-- Pending invitations predate expiry enforcement; give each the default
-- seven-day lifetime from its creation so stale links cannot stay live.
UPDATE "team_invites"
SET "expires_at" = "created_at" + INTERVAL '7 days'
WHERE "expires_at" IS NULL;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "project_video_url" text;--> statement-breakpoint
ALTER TABLE "judge_flags" ADD CONSTRAINT "judge_flags_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judge_flags" ADD CONSTRAINT "judge_flags_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judge_flags" ADD CONSTRAINT "judge_flags_judge_user_id_users_id_fk" FOREIGN KEY ("judge_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judge_flags" ADD CONSTRAINT "judge_flags_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "judge_flags_season_judge_team" ON "judge_flags" USING btree ("season_id","judge_user_id","team_id");--> statement-breakpoint
CREATE INDEX "judge_flags_season_resolved" ON "judge_flags" USING btree ("season_id","resolved_at");--> statement-breakpoint
CREATE UNIQUE INDEX "team_invites_token_unique" ON "team_invites" USING btree ("token");--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_max_team_members_check" CHECK ("seasons"."max_team_members" BETWEEN 1 AND 20);