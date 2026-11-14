import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RUBRIC_DEFINITION } from "~~/shared/rubric";

const postgresState = vi.hoisted(() => {
    const state: any = { mode: "current", responses: {} as Record<string, unknown[]> };
    const sql: any = (parts: TemplateStringsArray) => {
        const query = parts.join(" ").replace(/\s+/g, " ");
        if (query.includes("teams_without_season")) {
            return Promise.resolve(state.responses["teams_without_season"]);
        }
        if (query.includes("AS seasons")) return Promise.resolve(state.responses["AS seasons"]);
        if (query.includes("pg_get_serial_sequence('users'")) {
            return Promise.resolve(state.responses["pg_get_serial_sequence('users'"]);
        }
        if (query.includes("pg_get_serial_sequence('teams'")) {
            return Promise.resolve(state.responses["pg_get_serial_sequence('teams'"]);
        }
        for (const [marker, response] of Object.entries(state.responses)) {
            if (query.includes(marker)) return Promise.resolve(response);
        }
        throw new Error(`Unexpected verifier SQL: ${query}`);
    };
    sql.end = vi.fn(async () => undefined);
    state.sql = sql;
    state.postgres = vi.fn(() => sql);
    return state;
});

vi.mock("postgres", () => ({ default: postgresState.postgres }));

const legacyResponses = () => {
    postgresState.responses = {
        "FROM hackathon": [
            {
                id: 1,
                status: "finished",
                start_timestamp: Date.parse("2026-05-15T11:00:00.000Z"),
                end_timestamp: String(Date.parse("2026-05-22T11:00:00.000Z")),
            },
        ],
        "FROM seasons": [
            {
                id: 1,
                name: "Imported legacy season",
                is_active: 1,
                status: "finished",
                voting_enabled: 1,
                results_published: 1,
                judging_open: 1,
                show_scores: 0,
                show_ranking: 0,
                max_votes_per_user: 10,
                start_timestamp: String(Date.parse("2026-05-15T11:00:00.000Z")),
                end_timestamp: Date.parse("2026-05-22T11:00:00.000Z"),
                score_curve_preset: "original",
                rubric_version_id: 7,
            },
        ],
        "FROM teams": [
            {
                id: 42,
                season_id: 1,
                name: "Legacy import team",
                score: 21,
                rank: 1,
                project_name: "Legacy project",
                project_description: "Preserved legacy submission",
                project_demo_url: "https://demo.example.invalid",
                project_repo_url: "https://repo.example.invalid",
                project_submitted: 1,
            },
        ],
        "FROM users": [
            { id: 100, email: "legacy-judge@example.invalid", team_id: null },
            { id: 101, email: "legacy-participant@example.invalid", team_id: 42 },
        ],
        "FROM team_scores": [
            {
                team_id: 42,
                judge_user_id: 100,
                season_id: 1,
                scores: JSON.stringify({
                    originality: 5,
                    presentation: 4,
                    technicality: 3,
                    theme: 4,
                    impact: 5,
                }),
                reasoning: "Preserved legacy judge feedback.",
                rubric_version_id: 7,
            },
        ],
        "FROM rubric_versions": [
            {
                id: 7,
                season_id: 1,
                version: 1,
                name: "Imported legacy rubric",
                definition: JSON.stringify(DEFAULT_RUBRIC_DEFINITION),
            },
        ],
        "FROM sqlite_legacy_data": [
            { table_name: "team_scores", row_key: "801", payload: '{"id":801}' },
            { table_name: "users", row_key: "100", payload: { role: "judge", age: 15 } },
        ],
        teams_without_season: [{ teams_without_season: 0, broken_score_relations: 0 }],
        "AS seasons": [{ seasons: 1, teams: 1, users: 2, team_scores: 1 }],
    };
};

const currentResponses = () => {
    postgresState.responses = {
        "FROM hackathon": [{ id: 1, status: "finished", show_scores: 0, show_ranking: 0 }],
        "FROM seasons": [
            {
                id: 1,
                name: "Import smoke",
                is_active: 1,
                status: "finished",
                show_scores: 1,
                show_ranking: 1,
            },
            {
                id: 2,
                name: "Import smoke history",
                is_active: 0,
                status: "finished",
                show_scores: 1,
                show_ranking: 1,
            },
        ],
        "FROM users": [
            { id: 100, email: "judge@example.invalid", name: "Smoke Judge", team_id: null },
            {
                id: 101,
                email: "participant@example.invalid",
                name: "Smoke Participant",
                team_id: 42,
            },
        ],
        "FROM teams": [
            {
                id: 42,
                season_id: 1,
                name: "Import smoke team",
                project_name: "Smoke project",
                project_description: "Current project",
                project_demo_url: "https://demo.example.invalid",
                project_repo_url: "https://repo.example.invalid",
                project_submitted: 1,
                score: 21,
                rank: 1,
                pathway: "junior",
            },
            {
                id: 43,
                season_id: 2,
                name: "Import smoke history team",
                project_name: "Old project",
                project_description: "Historical project",
                project_demo_url: null,
                project_repo_url: null,
                project_submitted: 1,
                score: 18,
                rank: 2,
                pathway: "senior",
            },
        ],
        "FROM team_scores": [
            {
                team_id: 42,
                judge_user_id: 100,
                season_id: 1,
                scores: JSON.stringify({
                    originality: 5,
                    presentation: 4,
                    technicality: 3,
                    theme: 4,
                    impact: 5,
                }),
                reasoning: "Representative imported feedback.",
            },
            {
                team_id: 43,
                judge_user_id: 100,
                season_id: 2,
                scores: JSON.stringify({
                    originality: 4,
                    presentation: 3,
                    technicality: 4,
                    theme: 3,
                    impact: 4,
                }),
                reasoning: "Representative historical feedback.",
            },
        ],
        "FROM ballots": [
            {
                id: 501,
                user_id: 101,
                reasoning: "Representative peer ballot.",
                submitted: 1,
                score_id: 601,
                project_id: 43,
                score: 5,
            },
        ],
        "FROM oauth2_applications": [
            {
                client_id: "smoke-client",
                client_secret: "legacy-client-secret",
                permissions: '["teams.read"]',
                redirect_uris: '["https://client.example.invalid/callback"]',
                name: "Smoke OAuth app",
                description: "Legacy integration fixture",
                type: "confidential",
                profile_picture: null,
                owner_id: 101,
            },
        ],
        "FROM peer_voting_scores": [
            { user_id: 101, score: '{"impact":5}', reasoning: "Representative peer score." },
        ],
        "FROM user_past_teams": [{ user_id: 101, team_id: 43 }],
        "FROM sc_votes": [{ id: 701, user_id: 101, vote: "yes", submitted_at: 1760000000 }],
        "FROM team_awards": [
            {
                team_id: 42,
                award: "smoke-award",
                meta: '{"source":"fixture"}',
                name: "Smoke Award",
            },
        ],
        "FROM sqlite_legacy_data": [
            { table_name: "users", row_key: "100", payload: '{"role":"judge","age":15}' },
            {
                table_name: "oauth2_applications",
                row_key: "smoke-client",
                payload: { proxy_microsoft: 1 },
            },
            {
                table_name: "judge_scores_migrate",
                row_key: "801",
                payload: JSON.stringify({
                    field1: "801",
                    field2: "42",
                    field3: "100",
                    field4: '{"theme":5}',
                    field5: "Legacy artifact score row.",
                }),
            },
            { table_name: "teams", row_key: "42", payload: "{}" },
        ],
        "FROM rubric_versions rv": [
            { season_id: 1, name: "Import smoke", score_count: 1 },
            { season_id: 2, name: "Import smoke history", score_count: 1 },
        ],
        "pg_get_serial_sequence('users'": [{ id: 102 }],
        "pg_get_serial_sequence('teams'": [{ id: 44 }],
    };
};

describe("SQLite import smoke verification scripts", () => {
    beforeEach(() => {
        vi.stubEnv("DATABASE_URL", "postgresql://test@localhost/test");
        postgresState.sql.end.mockClear();
        postgresState.postgres.mockClear();
        vi.spyOn(console, "info").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
    });

    it("verifies preserved legacy import data and accepts numeric and string timestamps", async () => {
        legacyResponses();
        vi.resetModules();

        await import("../../scripts/verify-sqlite-legacy-import-smoke.mjs");

        expect(postgresState.postgres).toHaveBeenCalledWith(
            "postgresql://test@localhost/test",
            expect.objectContaining({ max: 1, prepare: false }),
        );
        expect(postgresState.sql.end).toHaveBeenCalledWith({ timeout: 5 });
        expect(console.info).toHaveBeenCalledWith(
            expect.stringContaining("Legacy SQLite import smoke verification passed"),
        );
    });

    it("rejects unsafe legacy timestamps while still closing the connection", async () => {
        legacyResponses();
        postgresState.responses["FROM hackathon"] = [
            {
                id: 1,
                status: "finished",
                start_timestamp: Number.MAX_SAFE_INTEGER + 1,
                end_timestamp: "2026-05-22T11:00:00.000Z",
            },
        ];
        vi.resetModules();

        await expect(import("../../scripts/verify-sqlite-legacy-import-smoke.mjs")).rejects.toThrow(
            "Expected a safe PostgreSQL integer value",
        );
        expect(postgresState.sql.end).toHaveBeenCalledWith({ timeout: 5 });
    });

    it("requires a database URL before initializing the legacy verifier", async () => {
        vi.stubEnv("DATABASE_URL", "");
        vi.resetModules();

        await expect(import("../../scripts/verify-sqlite-legacy-import-smoke.mjs")).rejects.toThrow(
            "DATABASE_URL is required to verify the legacy SQLite import",
        );
        expect(postgresState.postgres).not.toHaveBeenCalled();
    });

    it("verifies imported current and historical season rows and JSON payloads", async () => {
        currentResponses();
        vi.resetModules();

        await import("../../scripts/verify-sqlite-import-smoke.mjs");

        expect(postgresState.sql.end).toHaveBeenCalledWith({ timeout: 5 });
        expect(console.info).toHaveBeenCalledWith(
            expect.stringContaining("SQLite import smoke verification passed"),
        );
    });

    it("requires a database URL before opening a PostgreSQL client", async () => {
        vi.stubEnv("DATABASE_URL", "");
        vi.resetModules();

        await expect(import("../../scripts/verify-sqlite-import-smoke.mjs")).rejects.toThrow(
            "DATABASE_URL is required to verify the SQLite import",
        );
        expect(postgresState.postgres).not.toHaveBeenCalled();
    });
});
