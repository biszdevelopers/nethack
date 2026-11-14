import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "~~/server/database/schema";

const tables = Object.entries(schema).map(([exportName, table]) => ({
    exportName,
    config: getTableConfig(table),
}));

describe("PostgreSQL Drizzle schema definitions", () => {
    it.each(tables)("builds the $exportName table configuration", ({ exportName, config }) => {
        expect(config.name).toBe(
            exportName.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
        );
        expect(config.columns.length).toBeGreaterThan(0);
        expect(new Set(config.columns.map((column) => column.name)).size).toBe(
            config.columns.length,
        );

        for (const foreignKey of config.foreignKeys) {
            const reference = foreignKey.reference();
            expect(reference.columns.length).toBeGreaterThan(0);
            expect(reference.foreignColumns).toHaveLength(reference.columns.length);
            expect(reference.foreignTable).toBeDefined();
        }
    });

    it("keeps the active-season rubric relationship and team foreign keys explicit", () => {
        const season = getTableConfig(schema.seasons);
        const team = getTableConfig(schema.teams);

        expect(season.foreignKeys).toHaveLength(1);
        expect(season.foreignKeys[0]?.onDelete).toBe("restrict");
        expect(team.foreignKeys).toHaveLength(1);
        expect(team.foreignKeys[0]?.onDelete).toBe("restrict");
    });

    it("pins normalized scoring and vote constraints in the schema", () => {
        const hackathon = getTableConfig(schema.hackathon);
        const ballots = getTableConfig(schema.ballotScores);
        const seasons = getTableConfig(schema.seasons);

        expect(hackathon.checks.map((constraint) => constraint.name)).toEqual([
            "hackathon_id_check",
            "hackathon_status_check",
        ]);
        expect(ballots.checks.map((constraint) => constraint.name)).toEqual([
            "ballot_scores_score_check",
        ]);
        expect(seasons.checks.map((constraint) => constraint.name)).toEqual([
            "seasons_is_active_check",
            "seasons_score_curve_preset_check",
        ]);
    });
});
