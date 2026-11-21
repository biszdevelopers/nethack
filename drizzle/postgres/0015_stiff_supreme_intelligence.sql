CREATE TABLE "admin_audit_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor_user_id" integer,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "judge_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"season_id" integer NOT NULL,
	"judge_user_id" integer NOT NULL,
	"pathway" text,
	"team_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "judge_assignments_pathway_not_blank_check" CHECK ("judge_assignments"."pathway" IS NULL OR btrim("judge_assignments"."pathway") <> '')
);
--> statement-breakpoint
CREATE TABLE "judge_recusals" (
	"season_id" integer NOT NULL,
	"judge_user_id" integer NOT NULL,
	"team_id" integer NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "judge_recusals_season_id_judge_user_id_team_id_pk" PRIMARY KEY("season_id","judge_user_id","team_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Backfill season ownership before the NOT NULL/restrict foreign keys apply.
UPDATE "team_scores" ts
SET "season_id" = t."season_id"
FROM "teams" t
WHERE ts."team_id" = t."id" AND ts."season_id" IS NULL;--> statement-breakpoint
DELETE FROM "team_scores" WHERE "season_id" IS NULL;--> statement-breakpoint
-- Normalize values that would fail the new checks on a populated database.
UPDATE "users" SET "is_admin" = 0 WHERE "is_admin" NOT IN (0, 1);--> statement-breakpoint
UPDATE "teams" SET "project_submitted" = 0 WHERE "project_submitted" NOT IN (0, 1);--> statement-breakpoint
UPDATE "teams" SET "pathway" = NULL WHERE "pathway" IS NOT NULL AND btrim("pathway") = '';--> statement-breakpoint
UPDATE "ballots" SET "submitted" = 0 WHERE "submitted" NOT IN (0, 1);--> statement-breakpoint
UPDATE "hackathon" SET "voting_enabled" = 0 WHERE "voting_enabled" NOT IN (0, 1);--> statement-breakpoint
UPDATE "hackathon" SET "results_published" = 0 WHERE "results_published" NOT IN (0, 1);--> statement-breakpoint
UPDATE "hackathon" SET "show_scores" = 0 WHERE "show_scores" NOT IN (0, 1);--> statement-breakpoint
UPDATE "hackathon" SET "show_ranking" = 0 WHERE "show_ranking" NOT IN (0, 1);--> statement-breakpoint
UPDATE "hackathon" SET "judging_open" = 0 WHERE "judging_open" NOT IN (0, 1);--> statement-breakpoint
UPDATE "seasons" SET "voting_enabled" = 0 WHERE "voting_enabled" NOT IN (0, 1);--> statement-breakpoint
UPDATE "seasons" SET "results_published" = 0 WHERE "results_published" NOT IN (0, 1);--> statement-breakpoint
UPDATE "seasons" SET "judging_open" = 0 WHERE "judging_open" NOT IN (0, 1);--> statement-breakpoint
UPDATE "seasons" SET "show_scores" = 0 WHERE "show_scores" NOT IN (0, 1);--> statement-breakpoint
UPDATE "seasons" SET "show_ranking" = 0 WHERE "show_ranking" NOT IN (0, 1);--> statement-breakpoint
UPDATE "seasons" SET "is_active" = 0 WHERE "is_active" NOT IN (0, 1);--> statement-breakpoint
UPDATE "seasons" SET "is_blank_start" = 0 WHERE "is_blank_start" NOT IN (0, 1);--> statement-breakpoint
-- Make the case-insensitive uniqueness rules apply to existing data by
-- suffixing later duplicates with their immutable row id.
WITH ranked AS (
    SELECT "id", row_number() OVER (PARTITION BY "season_id", lower("name") ORDER BY "id") AS rn
    FROM "teams"
)
UPDATE "teams" SET "name" = "teams"."name" || ' (' || "teams"."id" || ')'
FROM ranked
WHERE "teams"."id" = ranked."id" AND ranked.rn > 1;--> statement-breakpoint
WITH ranked AS (
    SELECT "id", row_number() OVER (PARTITION BY lower("name") ORDER BY "id") AS rn
    FROM "seasons"
)
UPDATE "seasons" SET "name" = "seasons"."name" || ' (' || "seasons"."id" || ')'
FROM ranked
WHERE "seasons"."id" = ranked."id" AND ranked.rn > 1;--> statement-breakpoint
ALTER TABLE "team_scores" DROP CONSTRAINT "team_scores_season_id_seasons_id_fk";
--> statement-breakpoint
ALTER TABLE "team_scores" DROP CONSTRAINT "team_scores_team_season_fk";
--> statement-breakpoint
ALTER TABLE "team_scores" ALTER COLUMN "season_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "seasons" ADD COLUMN "results_published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "seasons" ADD COLUMN "results_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "team_scores" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "score_exact" double precision;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "owner_user_id" integer;--> statement-breakpoint
-- Legacy teams take their earliest current member as the notification owner.
UPDATE "teams" t
SET "owner_user_id" = m."user_id"
FROM (
    SELECT DISTINCT ON ("team_id") "team_id", "id" AS "user_id"
    FROM "users"
    WHERE "team_id" IS NOT NULL
    ORDER BY "team_id", "id"
) m
WHERE m."team_id" = t."id" AND t."owner_user_id" IS NULL;--> statement-breakpoint
ALTER TABLE "admin_audit_events" ADD CONSTRAINT "admin_audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judge_assignments" ADD CONSTRAINT "judge_assignments_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judge_assignments" ADD CONSTRAINT "judge_assignments_judge_user_id_users_id_fk" FOREIGN KEY ("judge_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judge_assignments" ADD CONSTRAINT "judge_assignments_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judge_recusals" ADD CONSTRAINT "judge_recusals_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judge_recusals" ADD CONSTRAINT "judge_recusals_judge_user_id_users_id_fk" FOREIGN KEY ("judge_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judge_recusals" ADD CONSTRAINT "judge_recusals_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_events_created" ON "admin_audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "admin_audit_events_entity" ON "admin_audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "admin_audit_events_actor" ON "admin_audit_events" USING btree ("actor_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "judge_assignments_unique" ON "judge_assignments" USING btree ("season_id","judge_user_id",coalesce("pathway", ''),coalesce("team_id", 0));--> statement-breakpoint
CREATE INDEX "judge_assignments_season_judge" ON "judge_assignments" USING btree ("season_id","judge_user_id");--> statement-breakpoint
CREATE INDEX "notifications_user_created" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "team_scores" ADD CONSTRAINT "team_scores_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_scores" ADD CONSTRAINT "team_scores_team_season_fk" FOREIGN KEY ("team_id","season_id") REFERENCES "public"."teams"("id","season_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "peer_voting_scores_season" ON "peer_voting_scores" USING btree ("season_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_seasons_name_lower" ON "seasons" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "team_scores_judge_season" ON "team_scores" USING btree ("judge_user_id","season_id");--> statement-breakpoint
CREATE INDEX "team_scores_rubric_version" ON "team_scores" USING btree ("rubric_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_season_name_lower_unique" ON "teams" USING btree ("season_id",lower("name"));--> statement-breakpoint
CREATE INDEX "teams_owner_user" ON "teams" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "user_past_teams_team" ON "user_past_teams" USING btree ("team_id");--> statement-breakpoint
ALTER TABLE "ballots" ADD CONSTRAINT "ballots_submitted_check" CHECK ("ballots"."submitted" IN (0, 1));--> statement-breakpoint
ALTER TABLE "hackathon" ADD CONSTRAINT "hackathon_voting_enabled_check" CHECK ("hackathon"."voting_enabled" IN (0, 1));--> statement-breakpoint
ALTER TABLE "hackathon" ADD CONSTRAINT "hackathon_results_published_check" CHECK ("hackathon"."results_published" IN (0, 1));--> statement-breakpoint
ALTER TABLE "hackathon" ADD CONSTRAINT "hackathon_show_scores_check" CHECK ("hackathon"."show_scores" IN (0, 1));--> statement-breakpoint
ALTER TABLE "hackathon" ADD CONSTRAINT "hackathon_show_ranking_check" CHECK ("hackathon"."show_ranking" IN (0, 1));--> statement-breakpoint
ALTER TABLE "hackathon" ADD CONSTRAINT "hackathon_judging_open_check" CHECK ("hackathon"."judging_open" IN (0, 1));--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_voting_enabled_check" CHECK ("seasons"."voting_enabled" IN (0, 1));--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_results_published_check" CHECK ("seasons"."results_published" IN (0, 1));--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_judging_open_check" CHECK ("seasons"."judging_open" IN (0, 1));--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_show_scores_check" CHECK ("seasons"."show_scores" IN (0, 1));--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_show_ranking_check" CHECK ("seasons"."show_ranking" IN (0, 1));--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_status_check" CHECK ("teams"."status" IN ('active', 'withdrawn', 'disqualified', 'no_show'));--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_project_submitted_check" CHECK ("teams"."project_submitted" IN (0, 1));--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_pathway_not_blank_check" CHECK ("teams"."pathway" IS NULL OR btrim("teams"."pathway") <> '');--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_is_admin_check" CHECK ("users"."is_admin" IN (0, 1));--> statement-breakpoint
ALTER TABLE "team_scores" VALIDATE CONSTRAINT "team_scores_team_season_fk";