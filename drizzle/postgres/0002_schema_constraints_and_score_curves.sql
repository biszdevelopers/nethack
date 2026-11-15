CREATE TABLE "sc_votes" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"vote" text,
	"submitted_at" integer
);
--> statement-breakpoint
CREATE TABLE "sqlite_legacy_data" (
	"table_name" text NOT NULL,
	"row_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "sqlite_legacy_data_table_name_row_key_pk" PRIMARY KEY("table_name","row_key")
);
--> statement-breakpoint
ALTER TABLE "teams" DROP CONSTRAINT "teams_pathway_check";--> statement-breakpoint
ALTER TABLE "teams" ALTER COLUMN "pathway" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "seasons" ADD COLUMN "score_curve_preset" text DEFAULT 'original' NOT NULL;--> statement-breakpoint
ALTER TABLE "sc_votes" ADD CONSTRAINT "sc_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ballot_scores" ADD CONSTRAINT "ballot_scores_ballot_id_ballots_id_fk" FOREIGN KEY ("ballot_id") REFERENCES "public"."ballots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ballot_scores" ADD CONSTRAINT "ballot_scores_project_id_teams_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ballots" ADD CONSTRAINT "ballots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judging_drafts" ADD CONSTRAINT "judging_drafts_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judging_drafts" ADD CONSTRAINT "judging_drafts_judge_user_id_users_id_fk" FOREIGN KEY ("judge_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judging_drafts" ADD CONSTRAINT "judging_drafts_rubric_version_id_rubric_versions_id_fk" FOREIGN KEY ("rubric_version_id") REFERENCES "public"."rubric_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth2_applications" ADD CONSTRAINT "oauth2_applications_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_voting_scores" ADD CONSTRAINT "peer_voting_scores_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_templates" ADD CONSTRAINT "rubric_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_versions" ADD CONSTRAINT "rubric_versions_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_versions" ADD CONSTRAINT "rubric_versions_source_template_id_rubric_templates_id_fk" FOREIGN KEY ("source_template_id") REFERENCES "public"."rubric_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_versions" ADD CONSTRAINT "rubric_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_awards" ADD CONSTRAINT "team_awards_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_awards" ADD CONSTRAINT "team_awards_award_awards_namespace_fk" FOREIGN KEY ("award") REFERENCES "public"."awards"("namespace") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_scores" ADD CONSTRAINT "team_scores_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_scores" ADD CONSTRAINT "team_scores_judge_user_id_users_id_fk" FOREIGN KEY ("judge_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_scores" ADD CONSTRAINT "team_scores_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_scores" ADD CONSTRAINT "team_scores_rubric_version_id_rubric_versions_id_fk" FOREIGN KEY ("rubric_version_id") REFERENCES "public"."rubric_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_past_teams" ADD CONSTRAINT "user_past_teams_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_past_teams" ADD CONSTRAINT "user_past_teams_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_score_curve_preset_check" CHECK ("seasons"."score_curve_preset" IN ('original', 'gentle', 'moderate', 'strong'));