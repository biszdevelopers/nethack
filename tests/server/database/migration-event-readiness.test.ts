import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
    resolve(import.meta.dirname, "../../../drizzle/postgres/0015_stiff_supreme_intelligence.sql"),
    "utf8",
);

describe("event-readiness migration", () => {
    it("backfills score seasons before enforcing NOT NULL", () => {
        const backfill = sql.indexOf('UPDATE "team_scores" ts');
        const notNull = sql.indexOf(
            'ALTER TABLE "team_scores" ALTER COLUMN "season_id" SET NOT NULL',
        );
        expect(backfill).toBeGreaterThan(-1);
        expect(notNull).toBeGreaterThan(backfill);
        expect(sql).toContain('DELETE FROM "team_scores" WHERE "season_id" IS NULL');
    });

    it("validates the composite team-season foreign key", () => {
        expect(sql).toContain(
            'ALTER TABLE "team_scores" VALIDATE CONSTRAINT "team_scores_team_season_fk"',
        );
        expect(sql).toContain(
            '"team_scores_team_season_fk" FOREIGN KEY ("team_id","season_id") REFERENCES "public"."teams"("id","season_id")',
        );
    });

    it("adds the operational tables without dropping anything", () => {
        for (const table of [
            "admin_audit_events",
            "notifications",
            "judge_assignments",
            "judge_recusals",
        ]) {
            expect(sql).toContain(`CREATE TABLE "${table}"`);
        }
        expect(sql).not.toMatch(/DROP\s+TABLE/i);
    });

    it("adds the uniqueness and integrity guards", () => {
        expect(sql).toContain('CREATE UNIQUE INDEX "teams_season_name_lower_unique"');
        expect(sql).toContain('CREATE UNIQUE INDEX "idx_seasons_name_lower"');
        expect(sql).toContain('"teams_status_check" CHECK');
        expect(sql).toContain('"teams_pathway_not_blank_check" CHECK');
        expect(sql).toContain('"users_is_admin_check" CHECK');
        expect(sql).toContain('"ballots_submitted_check" CHECK');
        expect(sql).toContain('"seasons_results_published_check" CHECK');
    });

    it("deduplicates existing names before adding case-insensitive indexes", () => {
        const dedupe = sql.indexOf("WITH ranked AS (");
        const teamsIndex = sql.indexOf('CREATE UNIQUE INDEX "teams_season_name_lower_unique"');
        const seasonsIndex = sql.indexOf('CREATE UNIQUE INDEX "idx_seasons_name_lower"');
        expect(dedupe).toBeGreaterThan(-1);
        expect(teamsIndex).toBeGreaterThan(dedupe);
        expect(seasonsIndex).toBeGreaterThan(dedupe);
    });
});
