#!/usr/bin/env node
import assert from "node:assert/strict";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required to verify the SQLite import.");

const sql = postgres(databaseUrl, {
    max: 1,
    connect_timeout: 10,
    idle_timeout: 5,
    prepare: false,
});

try {
    const [hackathon] = await sql`
        SELECT id, status, show_scores, show_ranking
        FROM hackathon
        WHERE id = 1
    `;
    assert.deepEqual(hackathon, { id: 1, status: "finished", show_scores: 0, show_ranking: 0 });

    const seasons = await sql`
        SELECT id, name, is_active, status, show_scores, show_ranking
        FROM seasons
        ORDER BY id
    `;
    assert.deepEqual(seasons, [
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
    ]);

    const users = await sql`
        SELECT id, email, name, team_id
        FROM users
        WHERE id IN (100, 101)
        ORDER BY id
    `;
    assert.deepEqual(users, [
        {
            id: 100,
            email: "judge@example.invalid",
            name: "Smoke Judge",
            team_id: null,
        },
        {
            id: 101,
            email: "participant@example.invalid",
            name: "Smoke Participant",
            team_id: 42,
        },
    ]);

    const teams = await sql`
        SELECT id, season_id, name, project_name, project_description, project_demo_url,
            project_repo_url, project_submitted, score, rank, pathway
        FROM teams
        WHERE id IN (42, 43)
        ORDER BY id
    `;
    assert.deepEqual(teams, [
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
    ]);

    const scores = await sql`
        SELECT team_id, judge_user_id, season_id, scores, reasoning
        FROM team_scores
        ORDER BY team_id
    `;
    assert.equal(scores.length, 2);
    assert.deepEqual(
        scores.map((score) => ({
            team_id: score.team_id,
            judge_user_id: score.judge_user_id,
            season_id: score.season_id,
            scores: JSON.parse(score.scores),
            reasoning: score.reasoning,
        })),
        [
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
                reasoning: "Representative imported feedback.",
            },
            {
                team_id: 43,
                judge_user_id: 100,
                season_id: 2,
                scores: {
                    originality: 4,
                    presentation: 3,
                    technicality: 4,
                    theme: 3,
                    impact: 4,
                },
                reasoning: "Representative historical feedback.",
            },
        ],
    );

    const ballots = await sql`
        SELECT b.id, b.user_id, b.reasoning, b.submitted, bs.id AS score_id,
            bs.project_id, bs.score
        FROM ballots b
        JOIN ballot_scores bs ON bs.ballot_id = b.id
    `;
    assert.deepEqual(ballots, [
        {
            id: 501,
            user_id: 101,
            reasoning: "Representative peer ballot.",
            submitted: 1,
            score_id: 601,
            project_id: 43,
            score: 5,
        },
    ]);

    const oauthApplications = await sql`
        SELECT client_id, client_secret, permissions, redirect_uris, name, description, type,
            profile_picture, owner_id
        FROM oauth2_applications
    `;
    assert.deepEqual(oauthApplications, [
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
    ]);

    const peerVotingScores = await sql`
        SELECT user_id, score, reasoning
        FROM peer_voting_scores
    `;
    assert.deepEqual(peerVotingScores, [
        { user_id: 101, score: '{"impact":5}', reasoning: "Representative peer score." },
    ]);

    const pastTeams = await sql`
        SELECT user_id, team_id
        FROM user_past_teams
    `;
    assert.deepEqual(pastTeams, [{ user_id: 101, team_id: 43 }]);

    const legacyVotes = await sql`
        SELECT id, user_id, vote, submitted_at
        FROM sc_votes
    `;
    assert.deepEqual(legacyVotes, [
        { id: 701, user_id: 101, vote: "yes", submitted_at: 1760000000 },
    ]);

    const awards = await sql`
        SELECT ta.team_id, ta.award, ta.meta, a.name
        FROM team_awards ta
        JOIN awards a ON a.namespace = ta.award
    `;
    assert.deepEqual(awards, [
        {
            team_id: 42,
            award: "smoke-award",
            meta: '{"source":"fixture"}',
            name: "Smoke Award",
        },
    ]);

    const archiveRows = await sql`
        SELECT table_name, row_key, payload
        FROM sqlite_legacy_data
        ORDER BY table_name, row_key
    `;
    assert.equal(archiveRows.length, 4);
    const archivedUser = archiveRows.find(
        (row) => row.table_name === "users" && row.row_key === "100",
    );
    assert.deepEqual(archivedUser?.payload, { role: "judge", age: 15 });
    const archivedOauthApplication = archiveRows.find(
        (row) => row.table_name === "oauth2_applications" && row.row_key === "smoke-client",
    );
    assert.deepEqual(archivedOauthApplication?.payload, { proxy_microsoft: 1 });
    const archivedJudgeScore = archiveRows.find(
        (row) => row.table_name === "judge_scores_migrate" && row.row_key === "801",
    );
    assert.deepEqual(archivedJudgeScore?.payload, {
        field1: "801",
        field2: "42",
        field3: "100",
        field4: '{"theme":5}',
        field5: "Legacy artifact score row.",
    });

    const rubricSeasons = await sql`
        SELECT rv.season_id, s.name, count(ts.team_id)::integer AS score_count
        FROM rubric_versions rv
        JOIN seasons s ON s.id = rv.season_id
        LEFT JOIN team_scores ts ON ts.rubric_version_id = rv.id
        GROUP BY rv.season_id, s.name
        ORDER BY rv.season_id
    `;
    assert.deepEqual(rubricSeasons, [
        { season_id: 1, name: "Import smoke", score_count: 1 },
        { season_id: 2, name: "Import smoke history", score_count: 1 },
    ]);

    const nextUserId = await sql`SELECT nextval(pg_get_serial_sequence('users', 'id')) AS id`;
    const nextTeamId = await sql`SELECT nextval(pg_get_serial_sequence('teams', 'id')) AS id`;
    assert.ok(Number(nextUserId[0].id) > 101, "user identity sequence must follow imported IDs");
    assert.ok(Number(nextTeamId[0].id) > 43, "team identity sequence must follow imported IDs");

    console.info(
        "SQLite import smoke verification passed: event state, identities, teams, submissions, votes, scores, rubric history, and archived fields are preserved.",
    );
} finally {
    await sql.end({ timeout: 5 });
}
