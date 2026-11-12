#!/usr/bin/env node
import assert from "node:assert/strict";
import postgres from "postgres";
import { DEFAULT_RUBRIC_DEFINITION } from "../shared/rubric.ts";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required to verify the legacy SQLite import.");

const sql = postgres(databaseUrl, {
    max: 1,
    connect_timeout: 10,
    idle_timeout: 5,
    prepare: false,
});

try {
    const expectedEventTimestamp = Date.parse("2026-05-15T11:00:00.000Z");
    const [hackathon] = await sql`
        SELECT id, status, start_timestamp, end_timestamp
        FROM hackathon
        WHERE id = 1
    `;
    assert.deepEqual(hackathon, {
        id: 1,
        status: "finished",
        start_timestamp: expectedEventTimestamp,
        end_timestamp: Date.parse("2026-05-22T11:00:00.000Z"),
    });

    const seasons = await sql`
        SELECT id, name, is_active, status, voting_enabled, results_published, judging_open,
            show_scores, show_ranking, max_votes_per_user, start_timestamp, end_timestamp,
            score_curve_preset, rubric_version_id
        FROM seasons
        ORDER BY id
    `;
    assert.equal(seasons.length, 1);
    assert.equal(seasons[0].id, 1);
    assert.equal(seasons[0].name, "Imported legacy season");
    assert.equal(seasons[0].is_active, 1);
    assert.equal(seasons[0].status, "finished");
    assert.equal(seasons[0].voting_enabled, 1);
    assert.equal(seasons[0].results_published, 1);
    assert.equal(seasons[0].judging_open, 1);
    assert.equal(seasons[0].show_scores, 0);
    assert.equal(seasons[0].show_ranking, 0);
    assert.equal(seasons[0].max_votes_per_user, 10);
    assert.equal(seasons[0].start_timestamp, expectedEventTimestamp);
    assert.equal(seasons[0].end_timestamp, Date.parse("2026-05-22T11:00:00.000Z"));
    assert.equal(seasons[0].score_curve_preset, "original");

    const teams = await sql`
        SELECT id, season_id, name, score, rank, project_name, project_description,
            project_demo_url, project_repo_url, project_submitted
        FROM teams
    `;
    assert.deepEqual(teams, [
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
    ]);

    const users = await sql`
        SELECT id, email, team_id
        FROM users
        ORDER BY id
    `;
    assert.deepEqual(users, [
        { id: 100, email: "legacy-judge@example.invalid", team_id: null },
        { id: 101, email: "legacy-participant@example.invalid", team_id: 42 },
    ]);

    const scores = await sql`
        SELECT team_id, judge_user_id, season_id, scores, reasoning, rubric_version_id
        FROM team_scores
    `;
    assert.equal(scores.length, 1);
    assert.deepEqual(
        {
            ...scores[0],
            scores: JSON.parse(scores[0].scores),
        },
        {
            team_id: 42,
            judge_user_id: 100,
            season_id: 1,
            scores: {
                originality: 5,
                presentation: 4,
                technicality: 3,
                theme: 4,
                impact: 5,
            },
            reasoning: "Preserved legacy judge feedback.",
            rubric_version_id: seasons[0].rubric_version_id,
        },
    );

    const [rubricVersion] = await sql`
        SELECT id, season_id, version, name, definition
        FROM rubric_versions
    `;
    assert.equal(rubricVersion.id, seasons[0].rubric_version_id);
    assert.equal(rubricVersion.season_id, 1);
    assert.equal(rubricVersion.version, 1);
    assert.equal(rubricVersion.name, "Imported legacy rubric");
    assert.deepEqual(parseJsonValue(rubricVersion.definition), DEFAULT_RUBRIC_DEFINITION);

    const archivedRows = await sql`
        SELECT table_name, row_key, payload
        FROM sqlite_legacy_data
        ORDER BY table_name, row_key
    `;
    const archivedScoreIdentity = archivedRows.find(
        (row) => row.table_name === "team_scores" && row.row_key === "801",
    );
    assert.deepEqual(parseJsonValue(archivedScoreIdentity?.payload), { id: 801 });
    const archivedJudge = archivedRows.find(
        (row) => row.table_name === "users" && row.row_key === "100",
    );
    assert.deepEqual(parseJsonValue(archivedJudge?.payload), { role: "judge", age: 15 });
    assert.equal(
        archivedRows.some((row) =>
            JSON.stringify(parseJsonValue(row.payload)).includes("fixture-one-time-login-code"),
        ),
        false,
        "legacy one-time login credentials must not be persisted",
    );
    assert.equal(
        archivedRows.some((row) => {
            const payload = parseJsonValue(row.payload);
            return "login_code" in payload || "login_expiry" in payload;
        }),
        false,
        "legacy login-code fields must not be archived",
    );

    const [relationshipCounts] = await sql`
        SELECT
            (SELECT count(*) FROM teams t LEFT JOIN seasons s ON s.id = t.season_id
                WHERE s.id IS NULL)::integer AS teams_without_season,
            (SELECT count(*) FROM team_scores ts
                LEFT JOIN teams t ON t.id = ts.team_id
                LEFT JOIN users u ON u.id = ts.judge_user_id
                LEFT JOIN rubric_versions rv ON rv.id = ts.rubric_version_id
                WHERE t.id IS NULL OR u.id IS NULL OR rv.id IS NULL OR rv.season_id <> ts.season_id
            )::integer AS broken_score_relations
    `;
    assert.deepEqual(relationshipCounts, { teams_without_season: 0, broken_score_relations: 0 });

    const [targetCounts] = await sql`
        SELECT
            (SELECT count(*) FROM seasons)::integer AS seasons,
            (SELECT count(*) FROM teams)::integer AS teams,
            (SELECT count(*) FROM users)::integer AS users,
            (SELECT count(*) FROM team_scores)::integer AS team_scores
    `;
    assert.deepEqual(targetCounts, { seasons: 1, teams: 1, users: 2, team_scores: 1 });

    console.info(
        "Legacy SQLite import smoke verification passed: configuration, IDs, score content, default rubric, relationships, and credential invalidation are preserved.",
    );
} finally {
    await sql.end({ timeout: 5 });
}

function parseJsonValue(value) {
    return typeof value === "string" ? JSON.parse(value) : value;
}
