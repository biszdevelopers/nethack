import { describe, expect, it, vi } from "vitest";
import { once } from "node:events";
import { parseInitialAdminEmails } from "~~/server/utils/initial-admins";
import { summarizePeerVoting, isVotingOpen } from "~~/server/utils/voting";
import { streamDatabaseExport } from "~~/server/utils/database-export-stream";
import { seedInitialAdmins } from "~~/server/database/migrate";

describe("initial administrator parsing", () => {
    it("treats a missing value as an empty allowlist", () => {
        expect(parseInitialAdminEmails(undefined)).toEqual([]);
        expect(parseInitialAdminEmails(null)).toEqual([]);
    });
});

describe("voting deadline fallbacks", () => {
    it("stays open when no voting deadline is configured", () => {
        expect(isVotingOpen({ status: "voting", voting_enabled: 1, voting_end_timestamp: 0 })).toBe(
            true,
        );
        expect(isVotingOpen({ status: "voting", voting_enabled: 1 })).toBe(true);
    });

    it("defaults deadline enforcement and the current clock", () => {
        vi.stubEnv("ENFORCE_DEADLINES", "0");
        try {
            expect(
                isVotingOpen({ status: "voting", voting_enabled: 1, voting_end_timestamp: 1 }),
            ).toBe(true);
        } finally {
            vi.unstubAllEnvs();
        }
    });
});

describe("peer voting summary edges", () => {
    it("ignores ballots without a team, invalid JSON, and invalid shapes", () => {
        const summary = summarizePeerVoting(
            [{ team_id: 1, name: "One", pathway: "junior" }],
            [
                { user_id: 1, team_id: null, score: JSON.stringify({ 1: 5 }) },
                { user_id: 2, team_id: 10, score: "{" },
                { user_id: 3, team_id: 10, score: "null" },
                { user_id: 4, team_id: 10, score: "[]" },
            ],
        );

        expect(summary).toMatchObject({ votingTeams: 0, ballots: 4 });
        expect(summary.projects).toEqual([{ team_id: 1, average_stars: null, team_units: 0 }]);
    });

    it("skips unknown projects and non-numeric scores", () => {
        const summary = summarizePeerVoting(
            [{ team_id: 1, name: "One", pathway: "junior" }],
            [{ user_id: 1, team_id: 10, score: JSON.stringify({ 1: "many", 99: 5 }) }],
        );

        expect(summary.projects).toEqual([{ team_id: 1, average_stars: 0, team_units: 0 }]);
    });
});

describe("database export stream failures", () => {
    it("wraps a non-Error rejection in an export failure", async () => {
        const stream = streamDatabaseExport(
            {
                transaction: async () => {
                    throw "boom";
                },
            } as any,
            "json",
        );

        const [error] = await once(stream, "error");
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe("export failed");
    });
});

describe("seedInitialAdmins", () => {
    it("intentionally leaves stored administrator flags unchanged", async () => {
        await expect(seedInitialAdmins({} as any)).resolves.toBeUndefined();
    });
});
