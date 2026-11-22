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
    doublePrecision,
    type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { RubricDefinition } from "../../shared/rubric";
import type { ScoreCurvePreset } from "../../shared/score-curve";

// ---------------------------------------------------------------------------
// Legacy live configuration retained for export, SQLite import, and rollback.
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
        // Editable visitor-facing copy shown above the schedule. Stored in
        // PostgreSQL even when the rest of the live settings come from YAML.
        announcement: text("announcement"),
        // Operational settings changed through the portal are stored here so
        // they keep applying even when HACKATHON.yml is remote and read-only.
        live_overrides: jsonb("live_overrides")
            .$type<Record<string, unknown>>()
            .notNull()
            .default({}),
    },
    (table) => [
        check("hackathon_id_check", sql`${table.id} = 1`),
        check(
            "hackathon_status_check",
            sql`${table.status} IN ('not_started', 'in_progress', 'voting', 'finished', 'paused')`,
        ),
        check("hackathon_voting_enabled_check", sql`${table.voting_enabled} IN (0, 1)`),
        check("hackathon_results_published_check", sql`${table.results_published} IN (0, 1)`),
        check("hackathon_show_scores_check", sql`${table.show_scores} IN (0, 1)`),
        check("hackathon_show_ranking_check", sql`${table.show_ranking} IN (0, 1)`),
        check("hackathon_judging_open_check", sql`${table.judging_open} IN (0, 1)`),
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
        project_video_url: text("project_video_url"),
        project_submitted: integer("project_submitted").notNull().default(0),
        submitted_at: timestamp("submitted_at", { withTimezone: true }),
        status: text("status")
            .$type<"active" | "withdrawn" | "disqualified" | "no_show">()
            .notNull()
            .default("active"),
        score_exact: doublePrecision("score_exact"),
        sourcing: text("sourcing").notNull().default(""),
        season_id: integer("season_id")
            .notNull()
            .default(1)
            .references(() => seasons.id, { onDelete: "restrict" }),
        // The team's owning account survives a participant leaving or being
        // removed; this is the account that receives roster notifications.
        owner_user_id: integer("owner_user_id").references((): AnyPgColumn => users.id, {
            onDelete: "set null",
        }),
    },
    (table) => [
        index("teams_score").on(table.score),
        index("teams_rank").on(table.rank),
        index("teams_season").on(table.season_id),
        index("teams_season_submitted").on(table.season_id, table.project_submitted),
        uniqueIndex("teams_season_name_lower_unique").on(
            table.season_id,
            sql`lower(${table.name})`,
        ),
        index("teams_owner_user").on(table.owner_user_id),
        check(
            "teams_status_check",
            sql`${table.status} IN ('active', 'withdrawn', 'disqualified', 'no_show')`,
        ),
        check("teams_project_submitted_check", sql`${table.project_submitted} IN (0, 1)`),
        check(
            "teams_pathway_not_blank_check",
            sql`${table.pathway} IS NULL OR btrim(${table.pathway}) <> ''`,
        ),
        // Target for the composite score FK below; a score must belong to the
        // same season as its team.
        uniqueIndex("teams_id_season_unique").on(table.id, table.season_id),
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
        // Every evaluation belongs to the season of its team. The composite
        // foreign key below guarantees the two agree.
        season_id: integer("season_id")
            .notNull()
            .references(() => seasons.id, { onDelete: "restrict" }),
        rubric_version_id: integer("rubric_version_id")
            .notNull()
            .references(() => rubricVersions.id, { onDelete: "restrict" }),
        created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        primaryKey({ columns: [table.team_id, table.judge_user_id] }),
        index("team_scores_season_judge").on(table.season_id, table.judge_user_id),
        index("team_scores_judge_season").on(table.judge_user_id, table.season_id),
        index("team_scores_rubric_version").on(table.rubric_version_id),
        foreignKey({
            columns: [table.team_id, table.season_id],
            foreignColumns: [teams.id, teams.season_id],
            name: "team_scores_team_season_fk",
        }).onDelete("restrict"),
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
        // basis-auth backchannel logout barrier: tokens issued at or before this
        // Unix second are rejected even if the cookie or token is still intact.
        tokens_valid_after: bigint("tokens_valid_after", { mode: "number" }),
        is_admin: integer("is_admin").notNull().default(0),
        // Locally granted judging role. Administrators already receive all
        // permissions; this flag promotes an ordinary participant to judge.
        is_judge: integer("is_judge").notNull().default(0),
    },
    (table) => [
        index("idx_users_email").on(table.email),
        uniqueIndex("idx_users_lower_email").on(sql`lower(${table.email})`),
        uniqueIndex("idx_users_auth_identity").on(table.auth_issuer, table.auth_subject),
        index("idx_users_team_id").on(table.team_id),
        check("users_is_admin_check", sql`${table.is_admin} IN (0, 1)`),
        check("users_is_judge_check", sql`${table.is_judge} IN (0, 1)`),
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
    (table) => [
        uniqueIndex("idx_ballots_user_id").on(table.user_id),
        check("ballots_submitted_check", sql`${table.submitted} IN (0, 1)`),
    ],
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
        is_blank_start: integer("is_blank_start").notNull().default(0),
        board_approved_at: timestamp("board_approved_at", { withTimezone: true }),
        // Keep the approver's user ID as historical evidence even if that
        // account is later removed; this is not a live ownership relation.
        board_approved_by: integer("board_approved_by"),
        is_active: integer("is_active").notNull().default(0),
        status: text("status").notNull().default("not_started"),
        voting_enabled: integer("voting_enabled").notNull().default(0),
        results_published: integer("results_published").notNull().default(0),
        judging_open: integer("judging_open").notNull().default(0),
        show_scores: integer("show_scores").notNull().default(0),
        show_ranking: integer("show_ranking").notNull().default(0),
        max_votes_per_user: integer("max_votes_per_user").notNull().default(0),
        max_team_members: integer("max_team_members").notNull().default(6),
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
        announcement: text("announcement"),
        results_published_at: timestamp("results_published_at", { withTimezone: true }),
        // Frozen standings at publication time. Later edits to teams or awards
        // cannot rewrite what the event already announced.
        results_snapshot: jsonb("results_snapshot").$type<Record<string, unknown>>(),
        score_curve_preset: text("score_curve_preset")
            .$type<ScoreCurvePreset>()
            .notNull()
            .default("original"),
        // The relationship is cyclic with rubric_versions.season_id, but both
        // rows are created in separate statements before the pointer is set.
        rubric_version_id: integer("rubric_version_id").references(
            (): AnyPgColumn => rubricVersions.id,
            {
                onDelete: "restrict",
            },
        ),
    },
    (table) => [
        uniqueIndex("idx_seasons_one_active")
            .on(table.is_active)
            .where(sql`${table.is_active} = 1`),
        uniqueIndex("idx_seasons_name_lower").on(sql`lower(${table.name})`),
        check("seasons_is_active_check", sql`${table.is_active} IN (0, 1)`),
        check("seasons_max_team_members_check", sql`${table.max_team_members} BETWEEN 1 AND 20`),
        check("seasons_is_blank_start_check", sql`${table.is_blank_start} IN (0, 1)`),
        check("seasons_voting_enabled_check", sql`${table.voting_enabled} IN (0, 1)`),
        check("seasons_results_published_check", sql`${table.results_published} IN (0, 1)`),
        check("seasons_judging_open_check", sql`${table.judging_open} IN (0, 1)`),
        check("seasons_show_scores_check", sql`${table.show_scores} IN (0, 1)`),
        check("seasons_show_ranking_check", sql`${table.show_ranking} IN (0, 1)`),
        check(
            "seasons_board_approval_pair_check",
            sql`(${table.board_approved_at} IS NULL AND ${table.board_approved_by} IS NULL) OR (${table.board_approved_at} IS NOT NULL AND ${table.board_approved_by} IS NOT NULL)`,
        ),
        check(
            "seasons_score_curve_preset_check",
            sql`${table.score_curve_preset} IN ('original', 'gentle', 'moderate', 'strong')`,
        ),
        check(
            "seasons_status_check",
            sql`${table.status} IN ('not_started', 'in_progress', 'voting', 'finished', 'paused')`,
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
// Operational observability and event-staff assignment tables.
// ---------------------------------------------------------------------------

/** Immutable record of an administrative mutation and the values it replaced. */
export const adminAuditEvents = pgTable(
    "admin_audit_events",
    {
        id: serial("id").primaryKey(),
        actor_user_id: integer("actor_user_id").references(() => users.id, {
            onDelete: "set null",
        }),
        action: text("action").notNull(),
        entity_type: text("entity_type").notNull(),
        entity_id: text("entity_id"),
        before: jsonb("before").$type<Record<string, unknown> | null>(),
        after: jsonb("after").$type<Record<string, unknown> | null>(),
        reason: text("reason"),
        request_id: text("request_id"),
        created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        index("admin_audit_events_created").on(table.created_at),
        index("admin_audit_events_entity").on(table.entity_type, table.entity_id),
        index("admin_audit_events_actor").on(table.actor_user_id),
    ],
);

/** In-app notification delivered to one user. */
export const notifications = pgTable(
    "notifications",
    {
        id: serial("id").primaryKey(),
        user_id: integer("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        type: text("type").notNull(),
        title: text("title").notNull(),
        body: text("body"),
        link: text("link"),
        read_at: timestamp("read_at", { withTimezone: true }),
        created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [index("notifications_user_created").on(table.user_id, table.created_at)],
);

/**
 * Optional judge scoping. A row with a NULL pathway and NULL team assigns every
 * submitted project in the season; otherwise it narrows the judge to one track
 * or one team. When an admin creates no rows, the historical all-projects queue
 * behavior applies.
 */
export const judgeAssignments = pgTable(
    "judge_assignments",
    {
        id: serial("id").primaryKey(),
        season_id: integer("season_id")
            .notNull()
            .references(() => seasons.id, { onDelete: "cascade" }),
        judge_user_id: integer("judge_user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        pathway: text("pathway"),
        team_id: integer("team_id").references(() => teams.id, { onDelete: "cascade" }),
        created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        uniqueIndex("judge_assignments_unique").on(
            table.season_id,
            table.judge_user_id,
            sql`coalesce(${table.pathway}, '')`,
            sql`coalesce(${table.team_id}, 0)`,
        ),
        index("judge_assignments_season_judge").on(table.season_id, table.judge_user_id),
        check(
            "judge_assignments_pathway_not_blank_check",
            sql`${table.pathway} IS NULL OR btrim(${table.pathway}) <> ''`,
        ),
    ],
);

/** A judge's explicit conflict-of-interest declaration for one project. */
export const judgeRecusals = pgTable(
    "judge_recusals",
    {
        season_id: integer("season_id")
            .notNull()
            .references(() => seasons.id, { onDelete: "cascade" }),
        judge_user_id: integer("judge_user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        team_id: integer("team_id")
            .notNull()
            .references(() => teams.id, { onDelete: "cascade" }),
        reason: text("reason"),
        created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [primaryKey({ columns: [table.season_id, table.judge_user_id, table.team_id] })],
);

/** One open conflict-of-interest flag per judge and project, visible to admins. */
export const judgeFlags = pgTable(
    "judge_flags",
    {
        id: serial("id").primaryKey(),
        season_id: integer("season_id")
            .notNull()
            .references(() => seasons.id, { onDelete: "cascade" }),
        team_id: integer("team_id")
            .notNull()
            .references(() => teams.id, { onDelete: "cascade" }),
        judge_user_id: integer("judge_user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        reason: text("reason").notNull(),
        resolved_at: timestamp("resolved_at", { withTimezone: true }),
        resolved_by: integer("resolved_by").references(() => users.id, { onDelete: "set null" }),
        created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        uniqueIndex("judge_flags_season_judge_team").on(
            table.season_id,
            table.judge_user_id,
            table.team_id,
        ),
        index("judge_flags_season_resolved").on(table.season_id, table.resolved_at),
    ],
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
        season_id: integer("season_id")
            .notNull()
            .references(() => seasons.id, { onDelete: "cascade" }),
        // Team the voter belonged to when the ballot was cast. Kept separate
        // from users.team_id so season rollover cannot reattribute old votes.
        team_id: integer("team_id").references(() => teams.id, { onDelete: "set null" }),
        score: text("score").notNull(),
        reasoning: text("reasoning"),
    },
    (table) => [
        uniqueIndex("peer_voting_scores_user_season_unique").on(table.user_id, table.season_id),
        index("peer_voting_scores_season").on(table.season_id),
        index("peer_voting_scores_team").on(table.team_id),
    ],
);

/** A team invitation a member can send; the recipient must accept before joining. */
export const teamInvites = pgTable(
    "team_invites",
    {
        id: serial("id").primaryKey(),
        team_id: integer("team_id")
            .notNull()
            .references(() => teams.id, { onDelete: "cascade" }),
        email: text("email").notNull(),
        invited_by: integer("invited_by").references(() => users.id, { onDelete: "set null" }),
        // Bearer invite secret is stored as a SHA-256 hex digest; the raw token
        // is returned once at creation and never re-read from storage.
        token: text("token"),
        expires_at: timestamp("expires_at", { withTimezone: true }),
        created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        uniqueIndex("team_invites_team_email").on(table.team_id, table.email),
        uniqueIndex("team_invites_token_unique").on(table.token),
        index("team_invites_email").on(table.email),
    ],
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
    (table) => [
        primaryKey({ columns: [table.user_id, table.team_id] }),
        index("user_past_teams_team").on(table.team_id),
    ],
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

/** Access tokens whose basis-auth refresh or logout already revoked them by `jti`. */
export const revokedAccessTokens = pgTable(
    "revoked_access_tokens",
    {
        jti: text("jti").primaryKey(),
        valid_after: bigint("valid_after", { mode: "number" }).notNull(),
        expires_at: bigint("expires_at", { mode: "number" }),
    },
    (table) => [index("revoked_access_tokens_expires_at").on(table.expires_at)],
);
