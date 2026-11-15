-- Existing fresh-install seeds inserted seasons.id explicitly and left the
-- serial sequence uncalled. Repair populated databases without advancing the
-- sequence on a genuinely empty database, where the seed must receive ID 1.
LOCK TABLE public.seasons IN ACCESS EXCLUSIVE MODE;
DO $$
DECLARE
	season_sequence text := pg_get_serial_sequence('public.seasons', 'id');
	maximum_id bigint;
	sequence_last_value bigint;
	sequence_is_called boolean;
BEGIN
	SELECT MAX(id) INTO maximum_id FROM public.seasons;
	IF maximum_id IS NULL THEN
		-- A truly empty target must still let the default season become ID 1.
		PERFORM setval(season_sequence::regclass, 1, false);
	ELSE
		EXECUTE format('SELECT last_value, is_called FROM %s', season_sequence::regclass)
			INTO sequence_last_value, sequence_is_called;
		IF NOT sequence_is_called OR sequence_last_value < maximum_id THEN
			PERFORM setval(season_sequence::regclass, GREATEST(sequence_last_value, maximum_id), true);
		END IF;
	END IF;
END
$$;
--> statement-breakpoint
-- Startup seeding repairs any stale pointer before requests are served. Clear
-- dangling pointers now so the new constraint also upgrades older databases.
UPDATE public.seasons AS season
SET rubric_version_id = NULL
WHERE season.rubric_version_id IS NOT NULL
	AND NOT EXISTS (
		SELECT 1 FROM public.rubric_versions AS version
		WHERE version.id = season.rubric_version_id
	);
--> statement-breakpoint
ALTER TABLE "seasons"
	ADD CONSTRAINT "seasons_rubric_version_id_rubric_versions_id_fk"
	FOREIGN KEY ("rubric_version_id") REFERENCES "public"."rubric_versions"("id")
	ON DELETE restrict ON UPDATE no action;
