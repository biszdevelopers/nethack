CREATE TABLE "awards" (
	"namespace" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"icon" text NOT NULL,
	"color" text DEFAULT 'gold' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ballot_scores" (
	"id" serial PRIMARY KEY NOT NULL,
	"ballot_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"score" integer,
	CONSTRAINT "ballot_scores_score_check" CHECK ("ballot_scores"."score" IS NULL OR "ballot_scores"."score" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE TABLE "ballots" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"reasoning" text,
	"submitted" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hackathon" (
	"id" integer PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"voting_enabled" integer DEFAULT 0 NOT NULL,
	"results_published" integer DEFAULT 0 NOT NULL,
	"show_scores" integer DEFAULT 0 NOT NULL,
	"show_ranking" integer DEFAULT 0 NOT NULL,
	"submitted_count" integer DEFAULT 0 NOT NULL,
	"max_votes_per_user" integer DEFAULT 0 NOT NULL,
	"judging_open" integer DEFAULT 0 NOT NULL,
	"schedule_start" text,
	"schedule_end" text,
	"start_timestamp" integer NOT NULL,
	"end_timestamp" integer NOT NULL,
	"voting_start_timestamp" integer NOT NULL,
	"voting_end_timestamp" integer NOT NULL,
	"results_open_timestamp" integer NOT NULL,
	"theme_name" text,
	"theme_description" text,
	CONSTRAINT "hackathon_id_check" CHECK ("hackathon"."id" = 1),
	CONSTRAINT "hackathon_status_check" CHECK ("hackathon"."status" IN ('not_started', 'in_progress', 'voting', 'finished', 'paused'))
);
--> statement-breakpoint
CREATE TABLE "judging_drafts" (
	"team_id" integer NOT NULL,
	"judge_user_id" integer NOT NULL,
	"rubric_version_id" integer NOT NULL,
	"scores" jsonb NOT NULL,
	"reasoning" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "judging_drafts_team_id_judge_user_id_pk" PRIMARY KEY("team_id","judge_user_id")
);
--> statement-breakpoint
CREATE TABLE "oauth2_applications" (
	"client_id" text PRIMARY KEY NOT NULL,
	"client_secret" text NOT NULL,
	"permissions" text,
	"redirect_uris" text,
	"name" text NOT NULL,
	"description" text,
	"type" text,
	"profile_picture" text,
	"owner_id" integer,
	CONSTRAINT "oauth2_applications_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "peer_voting_scores" (
	"user_id" integer NOT NULL,
	"score" text NOT NULL,
	"reasoning" text
);
--> statement-breakpoint
CREATE TABLE "rubric_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"definition" jsonb NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rubric_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"season_id" integer NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"definition" jsonb NOT NULL,
	"source_template_id" integer,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"is_active" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'not_started' NOT NULL,
	"voting_enabled" integer DEFAULT 0 NOT NULL,
	"results_published" integer DEFAULT 0 NOT NULL,
	"judging_open" integer DEFAULT 0 NOT NULL,
	"show_scores" integer DEFAULT 0 NOT NULL,
	"show_ranking" integer DEFAULT 0 NOT NULL,
	"max_votes_per_user" integer DEFAULT 0 NOT NULL,
	"schedule_start" text,
	"schedule_end" text,
	"start_timestamp" integer DEFAULT 0 NOT NULL,
	"end_timestamp" integer DEFAULT 0 NOT NULL,
	"voting_start_timestamp" integer DEFAULT 0 NOT NULL,
	"voting_end_timestamp" integer DEFAULT 0 NOT NULL,
	"results_open_timestamp" integer DEFAULT 0 NOT NULL,
	"theme_name" text,
	"theme_description" text,
	"rubric_version_id" integer,
	CONSTRAINT "seasons_name_unique" UNIQUE("name"),
	CONSTRAINT "seasons_is_active_check" CHECK ("seasons"."is_active" IN (0, 1))
);
--> statement-breakpoint
CREATE TABLE "team_awards" (
	"team_id" integer NOT NULL,
	"award" text NOT NULL,
	"meta" text NOT NULL,
	CONSTRAINT "team_awards_team_id_award_pk" PRIMARY KEY("team_id","award")
);
--> statement-breakpoint
CREATE TABLE "team_scores" (
	"team_id" integer NOT NULL,
	"judge_user_id" integer NOT NULL,
	"scores" text NOT NULL,
	"reasoning" text DEFAULT '<no reasoning provided>' NOT NULL,
	"season_id" integer,
	"rubric_version_id" integer NOT NULL,
	CONSTRAINT "team_scores_team_id_judge_user_id_pk" PRIMARY KEY("team_id","judge_user_id")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"pathway" text NOT NULL,
	"score" integer,
	"rank" integer,
	"project_name" text DEFAULT '' NOT NULL,
	"project_description" text DEFAULT '' NOT NULL,
	"project_demo_url" text,
	"project_repo_url" text,
	"project_submitted" integer DEFAULT 0 NOT NULL,
	"sourcing" text DEFAULT '' NOT NULL,
	"season_id" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "teams_pathway_check" CHECK ("teams"."pathway" IN ('junior', 'senior'))
);
--> statement-breakpoint
CREATE TABLE "user_past_teams" (
	"user_id" integer NOT NULL,
	"team_id" integer NOT NULL,
	CONSTRAINT "user_past_teams_user_id_team_id_pk" PRIMARY KEY("user_id","team_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"team_id" integer,
	"profile_theme" text,
	"profile_picture" text,
	"auth_issuer" text,
	"auth_subject" text,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE INDEX "idx_ballot_scores_project_id" ON "ballot_scores" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_ballot_scores_ballot_id" ON "ballot_scores" USING btree ("ballot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_unique_ballot_project" ON "ballot_scores" USING btree ("ballot_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_ballots_user_id" ON "ballots" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "judging_drafts_updated" ON "judging_drafts" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "peer_voting_scores_user_id_unique" ON "peer_voting_scores" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rubric_templates_name_lower" ON "rubric_templates" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "rubric_versions_season_version" ON "rubric_versions" USING btree ("season_id","version");--> statement-breakpoint
CREATE INDEX "rubric_versions_season" ON "rubric_versions" USING btree ("season_id");--> statement-breakpoint
CREATE INDEX "team_scores_season_judge" ON "team_scores" USING btree ("season_id","judge_user_id");--> statement-breakpoint
CREATE INDEX "teams_score" ON "teams" USING btree ("score");--> statement-breakpoint
CREATE INDEX "teams_rank" ON "teams" USING btree ("rank");--> statement-breakpoint
CREATE INDEX "teams_season" ON "teams" USING btree ("season_id");--> statement-breakpoint
CREATE INDEX "idx_users_email" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_users_lower_email" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "idx_users_auth_identity" ON "users" USING btree ("auth_issuer","auth_subject");--> statement-breakpoint
CREATE INDEX "idx_users_team_id" ON "users" USING btree ("team_id");