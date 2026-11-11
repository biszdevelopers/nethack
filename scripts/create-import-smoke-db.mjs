#!/usr/bin/env bun
import { resolve } from "node:path";

const outputPath = process.argv[2];
if (!outputPath) {
    throw new Error("Usage: bun scripts/create-import-smoke-db.mjs <output.sqlite> [--populate]");
}
const populate = process.argv.includes("--populate");

const { Database } = await import("bun:sqlite");
const database = new Database(resolve(outputPath));
try {
    database.exec(`
        CREATE TABLE hackathon (
            id INTEGER PRIMARY KEY,
            status TEXT NOT NULL,
            voting_enabled INTEGER NOT NULL DEFAULT 0,
            results_published INTEGER NOT NULL DEFAULT 0,
            show_scores INTEGER NOT NULL DEFAULT 0,
            show_ranking INTEGER NOT NULL DEFAULT 0,
            submitted_count INTEGER NOT NULL DEFAULT 0,
            max_votes_per_user INTEGER NOT NULL DEFAULT 0,
            judging_open INTEGER NOT NULL DEFAULT 0,
            schedule_start TEXT,
            schedule_end TEXT,
            start_timestamp INTEGER NOT NULL DEFAULT 0,
            end_timestamp INTEGER NOT NULL DEFAULT 0,
            voting_start_timestamp INTEGER NOT NULL DEFAULT 0,
            voting_end_timestamp INTEGER NOT NULL DEFAULT 0,
            results_open_timestamp INTEGER NOT NULL DEFAULT 0,
            theme_name TEXT,
            theme_description TEXT
        );
        CREATE TABLE seasons (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'not_started',
            show_scores INTEGER NOT NULL DEFAULT 0,
            show_ranking INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE teams (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            pathway TEXT,
            season_id INTEGER,
            score INTEGER,
            rank INTEGER,
            project_name TEXT NOT NULL DEFAULT '',
            project_description TEXT NOT NULL DEFAULT '',
            project_demo_url TEXT,
            project_repo_url TEXT,
            project_submitted INTEGER NOT NULL DEFAULT 0,
            sourcing TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            email TEXT NOT NULL,
            name TEXT,
            team_id INTEGER,
            role TEXT,
            age INTEGER
        );
        CREATE TABLE ballots (
            id INTEGER PRIMARY KEY,
            user_id INTEGER NOT NULL,
            reasoning TEXT,
            submitted INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE ballot_scores (
            id INTEGER PRIMARY KEY,
            ballot_id INTEGER NOT NULL,
            project_id INTEGER NOT NULL,
            score INTEGER
        );
        CREATE TABLE oauth2_applications (
            client_id TEXT PRIMARY KEY,
            client_secret TEXT NOT NULL,
            permissions TEXT,
            redirect_uris TEXT,
            name TEXT NOT NULL,
            description TEXT,
            type TEXT,
            profile_picture TEXT,
            owner_id INTEGER,
            proxy_microsoft INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE awards (
            namespace TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT NOT NULL,
            icon TEXT NOT NULL,
            color TEXT NOT NULL DEFAULT 'gold'
        );
        CREATE TABLE team_awards (
            team_id INTEGER NOT NULL,
            award TEXT NOT NULL,
            meta TEXT NOT NULL
        );
        CREATE TABLE peer_voting_scores (
            user_id INTEGER NOT NULL,
            score TEXT NOT NULL,
            reasoning TEXT
        );
        CREATE TABLE user_past_teams (
            user_id INTEGER NOT NULL,
            team_id INTEGER NOT NULL
        );
        CREATE TABLE sc_votes (
            id INTEGER PRIMARY KEY,
            user_id INTEGER,
            vote TEXT,
            submitted_at INTEGER
        );
        CREATE TABLE judge_scores_migrate (
            field1 TEXT,
            field2 TEXT,
            field3 TEXT,
            field4 TEXT,
            field5 TEXT
        );
        CREATE TABLE team_scores (
            team_id INTEGER NOT NULL,
            judge_user_id INTEGER NOT NULL,
            season_id INTEGER,
            scores TEXT NOT NULL,
            reasoning TEXT
        );
        INSERT INTO hackathon (id, status) VALUES (1, 'finished');
        INSERT INTO seasons (id, name, is_active, status, show_scores, show_ranking)
        VALUES
            (1, 'Import smoke', 1, 'finished', 1, 1),
            (2, 'Import smoke history', 0, 'finished', 1, 1);
    `);
    if (populate) {
        database.exec(`
            INSERT INTO teams (
                id, name, pathway, season_id, score, rank, project_name, project_description,
                project_demo_url, project_repo_url, project_submitted, sourcing
            )
            VALUES
                (42, 'Import smoke team', 'junior', 1, 21, 1, 'Smoke project', 'Current project',
                    'https://demo.example.invalid', 'https://repo.example.invalid', 1, 'fixture'),
                (43, 'Import smoke history team', 'senior', 2, 18, 2, 'Old project', 'Historical project',
                    NULL, NULL, 1, 'legacy');
            INSERT INTO users (id, email, name, team_id, role, age)
            VALUES
                (100, 'judge@example.invalid', 'Smoke Judge', NULL, 'judge', 15),
                (101, 'participant@example.invalid', 'Smoke Participant', 42, 'participant', 14);
            INSERT INTO team_scores (team_id, judge_user_id, season_id, scores, reasoning)
            VALUES (
                42,
                100,
                1,
                '{"originality":5,"presentation":4,"technicality":3,"theme":4,"impact":5}',
                'Representative imported feedback.'
            );
            INSERT INTO team_scores (team_id, judge_user_id, season_id, scores, reasoning)
            VALUES (
                43,
                100,
                2,
                '{"originality":4,"presentation":3,"technicality":4,"theme":3,"impact":4}',
                'Representative historical feedback.'
            );
            INSERT INTO ballots (id, user_id, reasoning, submitted)
            VALUES (501, 101, 'Representative peer ballot.', 1);
            INSERT INTO ballot_scores (id, ballot_id, project_id, score)
            VALUES (601, 501, 43, 5);
            INSERT INTO oauth2_applications (
                client_id, client_secret, permissions, redirect_uris, name, description,
                type, profile_picture, owner_id, proxy_microsoft
            ) VALUES (
                'smoke-client', 'legacy-client-secret', '["teams.read"]',
                '["https://client.example.invalid/callback"]', 'Smoke OAuth app',
                'Legacy integration fixture', 'confidential', NULL, 101, 1
            );
            INSERT INTO awards (namespace, name, description, icon, color)
            VALUES ('smoke-award', 'Smoke Award', 'Legacy award fixture', 'trophy', 'gold');
            INSERT INTO team_awards (team_id, award, meta)
            VALUES (42, 'smoke-award', '{"source":"fixture"}');
            INSERT INTO peer_voting_scores (user_id, score, reasoning)
            VALUES (101, '{"impact":5}', 'Representative peer score.');
            INSERT INTO user_past_teams (user_id, team_id) VALUES (101, 43);
            INSERT INTO sc_votes (id, user_id, vote, submitted_at)
            VALUES (701, 101, 'yes', 1760000000);
            INSERT INTO judge_scores_migrate (field1, field2, field3, field4, field5)
            VALUES
                ('id', 'team_id', 'judge_user_id', 'scores', 'reasoning'),
                ('801', '42', '100', '{"theme":5}', 'Legacy artifact score row.');
        `);
    }
} finally {
    database.close();
}
