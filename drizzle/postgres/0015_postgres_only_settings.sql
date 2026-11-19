-- Preserve portal settings already stored in PostgreSQL before removing the overlay.
UPDATE "hackathon" SET
    "status" = CASE WHEN live_overrides ? 'status' THEN live_overrides->>'status' ELSE "status" END,
    "voting_enabled" = CASE WHEN live_overrides ? 'voting_enabled' THEN (live_overrides->>'voting_enabled')::integer ELSE "voting_enabled" END,
    "results_published" = CASE WHEN live_overrides ? 'results_published' THEN (live_overrides->>'results_published')::integer ELSE "results_published" END,
    "judging_open" = CASE WHEN live_overrides ? 'judging_open' THEN (live_overrides->>'judging_open')::integer ELSE "judging_open" END,
    "show_scores" = CASE WHEN live_overrides ? 'show_scores' THEN (live_overrides->>'show_scores')::integer ELSE "show_scores" END,
    "show_ranking" = CASE WHEN live_overrides ? 'show_ranking' THEN (live_overrides->>'show_ranking')::integer ELSE "show_ranking" END,
    "max_votes_per_user" = CASE WHEN live_overrides ? 'max_votes_per_user' THEN (live_overrides->>'max_votes_per_user')::integer ELSE "max_votes_per_user" END,
    "announcement" = CASE WHEN live_overrides ? 'announcement' THEN live_overrides->>'announcement' ELSE "announcement" END;
--> statement-breakpoint
UPDATE "seasons" AS s SET
    "status" = h."status",
    "voting_enabled" = h."voting_enabled",
    "results_published" = h."results_published",
    "judging_open" = h."judging_open",
    "show_scores" = h."show_scores",
    "show_ranking" = h."show_ranking",
    "max_votes_per_user" = h."max_votes_per_user",
    "announcement" = h."announcement"
FROM "hackathon" AS h WHERE s.is_active = 1 AND h.id = 1;
--> statement-breakpoint
ALTER TABLE "hackathon" DROP COLUMN "live_overrides";