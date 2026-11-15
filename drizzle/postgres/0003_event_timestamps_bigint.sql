ALTER TABLE "hackathon"
    ALTER COLUMN "start_timestamp" TYPE bigint USING "start_timestamp"::bigint,
    ALTER COLUMN "end_timestamp" TYPE bigint USING "end_timestamp"::bigint,
    ALTER COLUMN "voting_start_timestamp" TYPE bigint USING "voting_start_timestamp"::bigint,
    ALTER COLUMN "voting_end_timestamp" TYPE bigint USING "voting_end_timestamp"::bigint,
    ALTER COLUMN "results_open_timestamp" TYPE bigint USING "results_open_timestamp"::bigint;
--> statement-breakpoint
ALTER TABLE "seasons"
    ALTER COLUMN "start_timestamp" TYPE bigint USING "start_timestamp"::bigint,
    ALTER COLUMN "end_timestamp" TYPE bigint USING "end_timestamp"::bigint,
    ALTER COLUMN "voting_start_timestamp" TYPE bigint USING "voting_start_timestamp"::bigint,
    ALTER COLUMN "voting_end_timestamp" TYPE bigint USING "voting_end_timestamp"::bigint,
    ALTER COLUMN "results_open_timestamp" TYPE bigint USING "results_open_timestamp"::bigint;
