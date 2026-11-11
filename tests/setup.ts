import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Graph env vars used by server/plugins/microsoft.ts. These are read at module load time, so they
// must be set before any test imports those modules. The values mirror the
// previously hardcoded configuration so existing assertions still hold.
process.env.MICROSOFT_TENANT_ID = "cbc6e1e2-a6bb-4002-bbdc-6da892a051a7";
process.env.MICROSOFT_CLIENT_ID = "868b989e-6574-4795-bcfb-8db37bee1c37";

// Runtime-agnostic sqlite statement wrapper.
// Under Bun we use bun:sqlite; under Node.js we use better-sqlite3.
// Both expose a near-identical prepare().run/all/get API.
class SQLiteStatement {
    private statement: any;
    private bindings: unknown[] = [];

    constructor(statement: any) {
        this.statement = statement;
    }

    bind(...params: unknown[]): this {
        this.bindings = params;
        return this;
    }

    first<T = unknown>(): T | undefined {
        return this.statement.get(...this.bindings) as T | undefined;
    }

    all<T = unknown>(): { results: T[] } {
        return { results: this.statement.all(...this.bindings) as T[] };
    }

    run(): { meta: { changed_db: number } } {
        const result = this.statement.run(...this.bindings);
        return { meta: { changed_db: result.changes ?? 0 } };
    }
}

// Thin runtime abstraction for the test database wrapper.
interface RawDatabase {
    exec(sql: string): void;
    prepare(sql: string): any;
    close(): void;
}

/**
 * D1-compatible Database wrapper, mirroring the SQLiteDatabase class in server/utils/database.ts.
 */
export class SQLiteDatabase {
    private db: RawDatabase;

    constructor(db: RawDatabase) {
        this.db = db;
    }

    prepare(sql: string): SQLiteStatement {
        return new SQLiteStatement(this.db.prepare(sql));
    }

    batch<T = unknown>(statements: Array<{ sql: string; params: unknown[] }>): T[] {
        const results: T[] = [];
        this.exec("BEGIN");
        try {
            for (const stmt of statements) {
                const prepared = this.db.prepare(stmt.sql);
                const result = prepared.all(...stmt.params);
                if (Array.isArray(result)) {
                    results.push(...(result as T[]));
                } else {
                    results.push(result as T);
                }
            }
            this.exec("COMMIT");
        } catch (e) {
            this.exec("ROLLBACK");
            throw e;
        }
        return results;
    }

    exec(sql: string): void {
        this.db.exec(sql);
    }

    /** Return the underlying raw sqlite instance (for Drizzle ORM) */
    getRawDb(): RawDatabase {
        return this.db;
    }

    /** Close the database connection */
    close(): void {
        this.db.close();
    }
}

// Path to the schema file relative to the project root
const schemaPath = resolve(import.meta.dirname, "..", "sql", "archive", "init.sql");
const schemaSQL = readFileSync(schemaPath, "utf-8");

/**
 * Create a fresh in-memory SQLite database with the full schema applied.
 * Use this in tests to get a clean, isolated database instance.
 */
export async function createTestDatabase(): Promise<SQLiteDatabase> {
    let db: RawDatabase;

    if (typeof Bun !== "undefined") {
        const { Database } = await import("bun:sqlite");
        db = new Database(":memory:") as RawDatabase;
    } else {
        const { default: Database } = await import("better-sqlite3");
        db = new Database(":memory:") as RawDatabase;
    }

    // Enable foreign keys just like the real app does
    db.exec("PRAGMA foreign_keys = ON");
    // Run the schema to create all tables and indexes
    db.exec(schemaSQL);

    // Apply migrations that add tables/columns not in init.sql
    db.exec(`
    CREATE TABLE IF NOT EXISTS seasons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_seasons_active ON seasons(is_active) WHERE is_active = 1;

    ALTER TABLE seasons ADD COLUMN status TEXT NOT NULL DEFAULT 'not_started';
    ALTER TABLE seasons ADD COLUMN voting_enabled INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE seasons ADD COLUMN results_published INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE seasons ADD COLUMN show_scores INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE seasons ADD COLUMN show_ranking INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE seasons ADD COLUMN max_votes_per_user INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE seasons ADD COLUMN judging_open INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE seasons ADD COLUMN schedule_start TEXT;
    ALTER TABLE seasons ADD COLUMN schedule_end TEXT;
    ALTER TABLE seasons ADD COLUMN start_timestamp INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE seasons ADD COLUMN end_timestamp INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE seasons ADD COLUMN voting_start_timestamp INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE seasons ADD COLUMN voting_end_timestamp INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE seasons ADD COLUMN results_open_timestamp INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE seasons ADD COLUMN theme_name TEXT;
    ALTER TABLE seasons ADD COLUMN theme_description TEXT;
    ALTER TABLE seasons ADD COLUMN score_curve_preset TEXT NOT NULL DEFAULT 'original';
    ALTER TABLE seasons ADD COLUMN rubric_version_id INTEGER;

    ALTER TABLE teams ADD COLUMN season_id INTEGER NOT NULL DEFAULT 1;
    CREATE INDEX IF NOT EXISTS teams_season ON teams (season_id);

    CREATE TABLE IF NOT EXISTS user_past_teams (
      user_id INTEGER NOT NULL,
      team_id INTEGER NOT NULL,
      PRIMARY KEY(user_id, team_id),
      FOREIGN KEY(team_id) REFERENCES teams(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    ALTER TABLE oauth2_applications ADD COLUMN owner_id INTEGER REFERENCES users(id);

    ALTER TABLE users ADD COLUMN auth_issuer TEXT;
    ALTER TABLE users ADD COLUMN auth_subject TEXT;
    CREATE UNIQUE INDEX idx_users_auth_identity ON users(auth_issuer, auth_subject);

    ALTER TABLE team_scores ADD COLUMN season_id INTEGER;
    ALTER TABLE team_scores ADD COLUMN rubric_version_id INTEGER;

    CREATE UNIQUE INDEX IF NOT EXISTS sc_votes_user_id_unique ON sc_votes(user_id);

    CREATE TABLE IF NOT EXISTS peer_voting_scores (
      user_id INTEGER PRIMARY KEY,
      score TEXT NOT NULL,
      reasoning TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS peer_voting_scores_user_id_unique ON peer_voting_scores(user_id);

    CREATE TABLE IF NOT EXISTS team_awards (
      team_id INTEGER NOT NULL,
      award TEXT NOT NULL,
      meta TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY(team_id, award),
      FOREIGN KEY(team_id) REFERENCES teams(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS awards (
      namespace TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      icon TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT 'gold'
    );

    CREATE TABLE IF NOT EXISTS rubric_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      definition TEXT NOT NULL,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS rubric_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      season_id INTEGER NOT NULL,
      version INTEGER NOT NULL,
      name TEXT NOT NULL,
      definition TEXT NOT NULL,
      source_template_id INTEGER,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (season_id, version)
    );

    CREATE TABLE IF NOT EXISTS judging_drafts (
      team_id INTEGER NOT NULL,
      judge_user_id INTEGER NOT NULL,
      rubric_version_id INTEGER NOT NULL,
      scores TEXT NOT NULL,
      reasoning TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (team_id, judge_user_id)
    );

    ALTER TABLE hackathon ADD COLUMN voting_enabled INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE hackathon ADD COLUMN results_published INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE hackathon ADD COLUMN show_scores INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE hackathon ADD COLUMN show_ranking INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE hackathon ADD COLUMN submitted_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE hackathon ADD COLUMN max_votes_per_user INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE hackathon ADD COLUMN judging_open INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE hackathon ADD COLUMN schedule_start TEXT;
    ALTER TABLE hackathon ADD COLUMN schedule_end TEXT;

  `);

    return new SQLiteDatabase(db);
}

/**
 * Reset a test database to a clean state by deleting all rows.
 * Faster than closing and re-opening for between-test resets.
 */
export function resetTestDatabase(wrapper: SQLiteDatabase): void {
    wrapper.exec(`
    DELETE FROM judging_drafts;
    DELETE FROM sc_votes;
    DELETE FROM ballot_scores;
    DELETE FROM ballots;
    DELETE FROM team_scores;
    DELETE FROM team_awards;
    DELETE FROM awards;
    DELETE FROM rubric_versions;
    DELETE FROM rubric_templates;
    DELETE FROM peer_voting_scores;
    DELETE FROM user_past_teams;
    DELETE FROM users;
    DELETE FROM oauth2_applications;
    DELETE FROM teams;
    DELETE FROM seasons;
    DELETE FROM hackathon;
  `);
}

// Re-export a placeholder; tests that need the raw driver class should not rely on it.
export const Database = null as any;
