import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { describe, expect, it } from "vitest";

const enabled = process.env.BASISHACKS_POSTGRES_TEST === "1" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!enabled)("PostgreSQL-only settings migration", () => {
    it("preserves saved overrides, dates, rubric pointers, and inactive seasons", async () => {
        const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
        try {
            // Temporary tables shadow the application tables on this connection.
            // The test never migrates or changes an existing deployment.
            await sql.begin(async (tx) => {
                await tx.unsafe(`CREATE TEMP TABLE hackathon (
                    id integer, status text, voting_enabled integer, results_published integer,
                    judging_open integer, show_scores integer, show_ranking integer,
                    max_votes_per_user integer, announcement text, start_timestamp bigint,
                    live_overrides jsonb
                ) ON COMMIT DROP`);
                await tx.unsafe(`CREATE TEMP TABLE seasons (
                    id integer, is_active integer, status text, voting_enabled integer,
                    results_published integer, judging_open integer, show_scores integer,
                    show_ranking integer, max_votes_per_user integer, announcement text,
                    start_timestamp bigint, rubric_version_id integer
                ) ON COMMIT DROP`);
                await tx.unsafe(`INSERT INTO hackathon VALUES
                    (1, 'voting', 1, 0, 1, 0, 0, 10, 'Old', 1800000000000,
                    '{"status":"finished","voting_enabled":0,"announcement":null}')`);
                await tx.unsafe(`INSERT INTO seasons VALUES
                    (1, 1, 'voting', 1, 0, 1, 0, 0, 10, 'Old', 1800000000000, 42),
                    (2, 0, 'not_started', 0, 0, 0, 0, 0, 5, 'Future', 1900000000000, 43)`);
                const migration = await readFile(
                    new URL(
                        "../../../drizzle/postgres/0015_postgres_only_settings.sql",
                        import.meta.url,
                    ),
                    "utf8",
                );
                for (const statement of migration.split("--> statement-breakpoint")) {
                    if (statement.trim()) await tx.unsafe(statement);
                }
                const [live] = await tx.unsafe("SELECT * FROM hackathon");
                expect(live).toMatchObject({
                    status: "finished",
                    voting_enabled: 0,
                    judging_open: 1,
                    max_votes_per_user: 10,
                    announcement: null,
                    start_timestamp: "1800000000000",
                });
                expect(live).not.toHaveProperty("live_overrides");
                const stored = await tx.unsafe("SELECT * FROM seasons ORDER BY id");
                expect(stored[0]).toMatchObject({
                    status: "finished",
                    announcement: null,
                    start_timestamp: "1800000000000",
                    rubric_version_id: 42,
                });
                expect(stored[1]).toMatchObject({
                    status: "not_started",
                    announcement: "Future",
                    start_timestamp: "1900000000000",
                    rubric_version_id: 43,
                });
            });
        } finally {
            await sql.end();
        }
    });
});
