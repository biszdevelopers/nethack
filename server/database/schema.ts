import {
    pgTable,
    serial,
    integer,
    bigint,
    text,
    jsonb,
    timestamp,
    uniqueIndex,
    index,
    check,
    primaryKey,
    foreignKey,
    boolean,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { RubricDefinition } from "../../shared/rubric";
import type { ScoreCurvePreset } from "../../shared/score-curve";

// ---------------------------------------------------------------------------
// Global hackathon state – a single row (id = 1) that controls the entire
// event lifecycle.
// ---------------------------------------------------------------------------
export const hackathon = pgTable(
    "hackathon",
    {
        id: integer("id").primaryKey(),
        status: text("status").notNull(),
        voting_enabled: integer("voting_enabled").notNull().default(0),
        results_published: integer("results_published").notNull().default(0),
        show_scores: integer("show_scores").notNull().default(0),
        show_ranking: integer("show_ranking").notNull().default(0),
        submitted_count: integer("submitted_count").notNull().default(0),
        max_votes_per_user: integer("max_votes_per_user").notNull().default(0),
        judging_open: integer("judging_open").notNull().default(0),
        schedule_start: text("schedule_start"),
        schedule_end: text("schedule_end"),
        start_timestamp: bigint("start_timestamp", { mode: "number" }).notNull(),
        end_timestamp: bigint("end_timestamp", { mode: "number" }).notNull(),
        voting_start_timestamp: bigint("voting_start_timestamp", { mode: "number" }).notNull(),
        voting_end_timestamp: bigint("voting_end_timestamp", { mode: "number" }).notNull(),
        results_open_timestamp: bigint("results_open_timestamp", { mode: "number" }).notNull(),
        theme_name: text("theme_name"),
        theme_description: text("theme_description"),
    },
    (table) => [
        check("hackathon_id_check", sql`${table.id} = 1`),
        check(
            "hackathon_status_check",
            sql`${table.status} IN ('not_started', 'in_progress', 'voting', 'finished', 'paused')`,
        ),
    ],
);

// ---------------------------------------------------------------------------
// Teams – a group of participants who submit a project together.
// ---------------------------------------------------------------------------
export const teams = pgTable(
    "teams",
    {
        id: serial("id").primaryKey(),
        name: text("name").notNull(),
        pathway: text("pathway"),
        score: integer("score"),
        rank: integer("rank"),
        project_name: text("project_name").notNull().default(""),
        project_description: text("project_description").notNull().default(""),
        project_demo_url: text("project_demo_url"),
        project_repo_url: text("project_repo_url"),
        project_submitted: integer("project_submitted").notNull().default(0),
        sourcing: text("sourcing").notNull().default(""),
        season_id: integer("season_id")
            .notNull()
            .default(1)
            .references(() => seasons.id, { onDelete: "restrict" }),
    },
    (table) => [
        index("teams_score").on(table.score),
        index("teams_rank").on(table.rank),
        index("teams_season").on(table.season_id),
        index("teams_season_submitted").on(table.season_id, table.project_submitted),
    ],
);

// ---------------------------------------------------------------------------
// Judge scores per team – each judge assigns structured scores (JSON) to a
// team. One row per (team, judge) pair.
// ---------------------------------------------------------------------------
export const teamScores = pgTable(
    "team_scores",
    {
        team_id: integer("team_id")
            .notNull()
            .references(() => teams.id, { onDelete: "cascade" }),
        judge_user_id: integer("judge_user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        scores: text("scores").notNull(),
        reasoning: text("reasoning").notNull().default("<no reasoning provided>"),
        season_id: integer("season_id").references(() => seasons.id, { onDelete: "set null" }),
        rubric_version_id: integer("rubric_version_id")
            .notNull()
            .references(() => rubricVersions.id, { onDelete: "restrict" }),
    },
    (table) => [
        primaryKey({ columns: [table.team_id, table.judge_user_id] }),
        index("team_scores_season_judge").on(table.season_id, table.judge_user_id),
    ],
);

// ---------------------------------------------------------------------------
// Users – all participants, judges, and admins.
// ---------------------------------------------------------------------------
export const users = pgTable(
    "users",
    {
        id: serial("id").primaryKey(),
        email: text("email").notNull().unique(),
        name: text("name"),
        team_id: integer("team_id").references(() => teams.id, { onDelete: "set null" }),
        profile_theme: text("profile_theme"),
        profile_picture: text("profile_picture"),
        auth_issuer: text("auth_issuer"),
        auth_subject: text("auth_subject"),
    },
    (table) => [
        index("idx_users_email").on(table.email),
        uniqueIndex("idx_users_lower_email").on(sql`lower(${table.email})`),
        uniqueIndex("idx_users_auth_identity").on(table.auth_issuer, table.auth_subject),
        index("idx_users_team_id").on(table.team_id),
    ],
);

// ---------------------------------------------------------------------------
// Ballots – a user's peer-voting ballot. Each user can have at most one
// ballot (enforced by the unique index below).
// ---------------------------------------------------------------------------
export const ballots = pgTable(
    "ballots",
    {
        id: serial("id").primaryKey(),
        user_id: integer("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        reasoning: text("reasoning"),
        submitted: integer("submitted").notNull().default(0),
    },
    (table) => [uniqueIndex("idx_ballots_user_id").on(table.user_id)],
);

// ---------------------------------------------------------------------------
// Individual scores within a ballot – each row assigns a 1–5 score to a
// specific project.
// ---------------------------------------------------------------------------
export const ballotScores = pgTable(
    "ballot_scores",
    {
        id: serial("id").primaryKey(),
        ballot_id: integer("ballot_id")
            .notNull()
            .references(() => ballots.id, { onDelete: "cascade" }),
        project_id: integer("project_id")
            .notNull()
            .references(() => teams.id, { onDelete: "cascade" }),
        score: integer("score"),
    },
    (table) => [
        index("idx_ballot_scores_project_id").on(table.project_id),
        index("idx_ballot_scores_ballot_id").on(table.ballot_id),
        uniqueIndex("idx_unique_ballot_project").on(table.ballot_id, table.project_id),
        check(
            "ballot_scores_score_check",
            sql`${table.score} IS NULL OR ${table.score} BETWEEN 1 AND 5`,
        ),
    ],
);

// ---------------------------------------------------------------------------
// OAuth2 applications registered on the platform (first-party and third-party).
// ---------------------------------------------------------------------------
export const oauth2Applications = pgTable("oauth2_applications", {
    client_id: text("client_id").primaryKey(),
    client_secret: text("client_secret").notNull(),
    permissions: text("permissions"),
    redirect_uris: text("redirect_uris"),
    name: text("name").notNull(),
    description: text("description"),
    type: text("type"),
    profile_picture: text("profile_picture"),
    owner_id: integer("owner_id").references(() => users.id, { onDelete: "set null" }),
});

// ---------------------------------------------------------------------------
// Seasons – each hackathon "season" is an independent event cycle.
// ---------------------------------------------------------------------------
export const seasons = pgTable(
    "seasons",
    {
        id: serial("id").primaryKey(),
        name: text("name").notNull().unique(),
        is_active: integer("is_active").notNull().default(0),
        status: text("status").notNull().default("not_started"),
        voting_enabled: integer("voting_enabled").notNull().default(0),
        results_published: integer("results_published").notNull().default(0),
        judging_open: integer("judging_open").notNull().default(0),
        show_scores: integer("show_scores").notNull().default(0),
        show_ranking: integer("show_ranking").notNull().default(0),
        max_votes_per_user: integer("max_votes_per_user").notNull().default(0),
        schedule_start: text("schedule_start"),
        schedule_end: text("schedule_end"),
        start_timestamp: bigint("start_timestamp", { mode: "number" }).notNull().default(0),
        end_timestamp: bigint("end_timestamp", { mode: "number" }).notNull().default(0),
        voting_start_timestamp: bigint("voting_start_timestamp", { mode: "number" })
            .notNull()
            .default(0),
        voting_end_timestamp: bigint("voting_end_timestamp", { mode: "number" })
            .notNull()
            .default(0),
        results_open_timestamp: bigint("results_open_timestamp", { mode: "number" })
            .notNull()
            .default(0),
        theme_name: text("theme_name"),
        theme_description: text("theme_description"),
        score_curve_preset: text("score_curve_preset")
            .$type<ScoreCurvePreset>()
            .notNull()
            .default("original"),
        // The relationship is cyclic with rubric_versions.season_id, but both
        // rows are created in separate statements before the pointer is set.
        rubric_version_id: integer("rubric_version_id").references(() => rubricVersions.id, {
            onDelete: "restrict",
        }),
    },
    (table) => [
        uniqueIndex("idx_seasons_one_active")
            .on(table.is_active)
            .where(sql`${table.is_active} = 1`),
        check("seasons_is_active_check", sql`${table.is_active} IN (0, 1)`),
        check(
            "seasons_score_curve_preset_check",
            sql`${table.score_curve_preset} IN ('original', 'gentle', 'moderate', 'strong')`,
        ),
    ],
);

// ---------------------------------------------------------------------------
// Award definitions and their per-team assignments.
// ---------------------------------------------------------------------------
export const awards = pgTable("awards", {
    namespace: text("namespace").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    icon: text("icon").notNull(),
    color: text("color").notNull().default("gold"),
});

export const teamAwards = pgTable(
    "team_awards",
    {
        team_id: integer("team_id")
            .notNull()
            .references(() => teams.id, { onDelete: "cascade" }),
        award: text("award")
            .notNull()
            .references(() => awards.namespace, { onDelete: "restrict" }),
        meta: text("meta").notNull(),
    },
    (table) => [primaryKey({ columns: [table.team_id, table.award] })],
);

// ---------------------------------------------------------------------------
// Peer-voting scores – each user submits one structured peer vote.
// ---------------------------------------------------------------------------
export const peerVotingScores = pgTable(
    "peer_voting_scores",
    {
        user_id: integer("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        score: text("score").notNull(),
        reasoning: text("reasoning"),
    },
    (table) => [uniqueIndex("peer_voting_scores_user_id_unique").on(table.user_id)],
);

// ---------------------------------------------------------------------------
// Tracks which teams a user was previously a member of (for history).
// ---------------------------------------------------------------------------
export const userPastTeams = pgTable(
    "user_past_teams",
    {
        user_id: integer("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        team_id: integer("team_id")
            .notNull()
            .references(() => teams.id, { onDelete: "cascade" }),
    },
    (table) => [primaryKey({ columns: [table.user_id, table.team_id] })],
);

// ---------------------------------------------------------------------------
// Rubric templates and immutable season versions. Definitions are snapshots so
// edits to a reusable template can never change finalized historical scores.
// ---------------------------------------------------------------------------
export const rubricTemplates = pgTable(
    "rubric_templates",
    {
        id: serial("id").primaryKey(),
        name: text("name").notNull(),
        description: text("description"),
        definition: jsonb("definition").$type<RubricDefinition>().notNull(),
        created_by: integer("created_by").references(() => users.id, { onDelete: "set null" }),
        created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [uniqueIndex("rubric_templates_name_lower").on(sql`lower(${table.name})`)],
);

export const rubricVersions = pgTable(
    "rubric_versions",
    {
        id: serial("id").primaryKey(),
        season_id: integer("season_id")
            .notNull()
            .references(() => seasons.id, { onDelete: "restrict" }),
        version: integer("version").notNull(),
        name: text("name").notNull(),
        definition: jsonb("definition").$type<RubricDefinition>().notNull(),
        source_template_id: integer("source_template_id").references(() => rubricTemplates.id, {
            onDelete: "set null",
        }),
        created_by: integer("created_by").references(() => users.id, { onDelete: "set null" }),
        created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        uniqueIndex("rubric_versions_season_version").on(table.season_id, table.version),
        index("rubric_versions_season").on(table.season_id),
    ],
);

export const judgingDrafts = pgTable(
    "judging_drafts",
    {
        team_id: integer("team_id")
            .notNull()
            .references(() => teams.id, { onDelete: "cascade" }),
        judge_user_id: integer("judge_user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        rubric_version_id: integer("rubric_version_id")
            .notNull()
            .references(() => rubricVersions.id, { onDelete: "restrict" }),
        scores: jsonb("scores").$type<Record<string, number>>().notNull(),
        reasoning: text("reasoning").notNull().default(""),
        updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        primaryKey({ columns: [table.team_id, table.judge_user_id] }),
        index("judging_drafts_updated").on(table.updated_at),
    ],
);

/** Legacy ballot rows are retained during the SQLite import for audit/history. */
export const scVotes = pgTable("sc_votes", {
    id: serial("id").primaryKey(),
    user_id: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    vote: text("vote"),
    submitted_at: integer("submitted_at"),
});

/** Retains legacy SQLite-only fields and migration artifacts without using them for auth. */
export const sqliteLegacyData = pgTable(
    "sqlite_legacy_data",
    {
        table_name: text("table_name").notNull(),
        row_key: text("row_key").notNull(),
        payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    },
    (table) => [primaryKey({ columns: [table.table_name, table.row_key] })],
);

/** New content-addressed public uploads that the application can safely collect. */
export const assetObjects = pgTable(
    "asset_objects",
    {
        collection: text("collection").notNull(),
        asset_path: text("asset_path").notNull(),
        sha256: text("sha256").notNull(),
        byte_size: bigint("byte_size", { mode: "number" }).notNull(),
        pinned: boolean("pinned").notNull().default(false),
        created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        unreferenced_at: timestamp("unreferenced_at", { withTimezone: true }),
    },
    (table) => [
        primaryKey({ columns: [table.collection, table.asset_path] }),
        index("asset_objects_gc").on(table.unreferenced_at, table.collection, table.asset_path),
        check(
            "asset_objects_collection_check",
            sql`${table.collection} IN ('assets', 'userassets')`,
        ),
        check("asset_objects_sha256_check", sql`${table.sha256} ~ '^[a-f0-9]{64}$'`),
        check("asset_objects_size_check", sql`${table.byte_size} >= 0`),
        check(
            "asset_objects_path_check",
            sql`(${table.collection} = 'assets' AND ${table.asset_path} ~ ('^uploads/' || ${table.sha256} || '\\.[a-z0-9]+$')) OR (${table.collection} = 'userassets' AND ${table.asset_path} ~ ('^' || ${table.sha256} || '\\.[a-z0-9]+$'))`,
        ),
    ],
);

/** Explicit active permalink references; releasing one starts the seven-day GC grace period. */
export const assetReferences = pgTable(
    "asset_references",
    {
        id: text("id").primaryKey(),
        collection: text("collection").notNull(),
        asset_path: text("asset_path").notNull(),
        reference_type: text("reference_type").notNull().default("permalink"),
        created_by: integer("created_by").references(() => users.id, { onDelete: "set null" }),
        created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        foreignKey({
            columns: [table.collection, table.asset_path],
            foreignColumns: [assetObjects.collection, assetObjects.asset_path],
            name: "asset_references_object_fk",
        }).onDelete("cascade"),
        index("asset_references_object").on(table.collection, table.asset_path),
        check("asset_references_type_check", sql`${table.reference_type} = 'permalink'`),
    ],
);
