import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { asc, desc, eq } from "drizzle-orm";
import type { Sql } from "postgres";
import { createMigrationDatabase, type DrizzleDatabase } from "./index";
import { hackathon, rubricTemplates, rubricVersions, seasons } from "./schema";
import { DEFAULT_RUBRIC_DEFINITION } from "../../shared/rubric";

const MIGRATIONS_FOLDER = resolve(process.cwd(), "drizzle/postgres");
const MIGRATION_LOCK_ID = BigInt("75110114284009");

/** Apply generated PostgreSQL migrations while serializing concurrent startups. */
export async function migrateDatabase(
    database: DrizzleDatabase,
    migrationsFolder: string = MIGRATIONS_FOLDER,
    client?: Sql,
): Promise<void> {
    // Tests and callers may inject a database/client pair. Production opens a
    // dedicated migrator pool whose connections have no statement timeout, so a
    // large DDL batch cannot be cancelled by the request pool's 15 s limit.
    const migration = client ? { database, client } : await createMigrationDatabase();
    try {
        await migration.client.begin(async (connection) => {
            await connection`SET LOCAL statement_timeout = 0`;
            await connection`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK_ID})`;
            await migrate(migration.database, { migrationsFolder });
        });
    } finally {
        if (!client) await migration.client.end({ timeout: 5 });
    }
}

/** Create the global event row on a fresh database without overwriting state. */
export async function seedHackathon(database: DrizzleDatabase): Promise<void> {
    await database
        .insert(hackathon)
        .values({
            id: 1,
            status: "not_started",
            start_timestamp: 0,
            end_timestamp: 0,
            voting_start_timestamp: 0,
            voting_end_timestamp: 0,
            results_open_timestamp: 0,
        })
        .onConflictDoNothing({ target: hackathon.id });
}

/** Add the next event shell without carrying over live settings or a rubric. */
export async function seedNextSeason(database: DrizzleDatabase): Promise<void> {
    await database
        .insert(seasons)
        .values({
            name: "Next season",
            is_blank_start: 1,
            is_active: 0,
            status: "not_started",
            voting_enabled: 0,
            results_published: 0,
            judging_open: 0,
            show_scores: 0,
            show_ranking: 0,
            max_votes_per_user: 0,
            schedule_start: null,
            schedule_end: null,
            start_timestamp: 0,
            end_timestamp: 0,
            voting_start_timestamp: 0,
            voting_end_timestamp: 0,
            results_open_timestamp: 0,
            theme_name: null,
            theme_description: null,
            rubric_version_id: null,
        })
        .onConflictDoNothing();
}

/** Seed a usable first season and attach immutable default rubric versions. */
export async function seedDefaultSeasonAndRubrics(database: DrizzleDatabase): Promise<void> {
    await database.transaction(async (tx) => {
        const seasonRows = await tx.select().from(seasons).orderBy(asc(seasons.id));
        if (seasonRows.length === 0) {
            await tx
                .insert(seasons)
                // Let PostgreSQL's serial sequence assign the first ID. Supplying
                // id: 1 here leaves seasons_id_seq unadvanced and makes the next
                // generated season collide with this row.
                .values({ name: "Season 1", is_active: 1 })
                .onConflictDoNothing();
        }

        let template = (
            await tx
                .select()
                .from(rubricTemplates)
                .where(eq(rubricTemplates.name, "BIBS-C Default"))
                .limit(1)
        )[0];
        if (!template) {
            template = (
                await tx
                    .insert(rubricTemplates)
                    .values({
                        name: "BIBS-C Default",
                        description: "The original BIBS-C judging rubric.",
                        definition: DEFAULT_RUBRIC_DEFINITION,
                        created_at: new Date(),
                        updated_at: new Date(),
                    })
                    .onConflictDoNothing()
                    .returning()
            )[0];
            template ??= (
                await tx
                    .select()
                    .from(rubricTemplates)
                    .where(eq(rubricTemplates.name, "BIBS-C Default"))
                    .limit(1)
            )[0];
        }

        const allSeasons = await tx.select().from(seasons).orderBy(asc(seasons.id));
        for (const season of allSeasons) {
            // Blank shells deliberately have no default rubric. They become
            // eligible for activation only after organizers configure one.
            if (season.is_blank_start === 1 && season.rubric_version_id === null) continue;
            const pointedVersion = season.rubric_version_id
                ? (
                      await tx
                          .select()
                          .from(rubricVersions)
                          .where(eq(rubricVersions.id, season.rubric_version_id))
                          .limit(1)
                  )[0]
                : undefined;
            if (pointedVersion?.season_id === season.id) continue;

            const priorVersion = (
                await tx
                    .select()
                    .from(rubricVersions)
                    .where(eq(rubricVersions.season_id, season.id))
                    .orderBy(desc(rubricVersions.version))
                    .limit(1)
            )[0];
            const version =
                priorVersion ??
                (
                    await tx
                        .insert(rubricVersions)
                        .values({
                            season_id: season.id,
                            version: 1,
                            name: "BIBS-C Default",
                            definition: DEFAULT_RUBRIC_DEFINITION,
                            source_template_id: template?.id,
                            created_at: new Date(),
                        })
                        .onConflictDoNothing()
                        .returning()
                )[0] ??
                (
                    await tx
                        .select()
                        .from(rubricVersions)
                        .where(eq(rubricVersions.season_id, season.id))
                        .orderBy(desc(rubricVersions.version))
                        .limit(1)
                )[0];

            if (version) {
                await tx
                    .update(seasons)
                    .set({ rubric_version_id: version.id })
                    .where(eq(seasons.id, season.id));
            }
        }
    });
}

/** Keep the designated initial administrators elevated across restarts and imports. */
export async function seedInitialAdmins(database: DrizzleDatabase): Promise<void> {
    // Initial administrators are elevated when they first sign in. Re-elevating
    // every configured email on boot would silently undo a deliberate demotion.
    void database;
}

/** Migrate and seed before Nitro begins accepting requests. */
export async function createAndMigrateDatabase(database: DrizzleDatabase): Promise<void> {
    await migrateDatabase(database);
    await seedHackathon(database);
    await seedDefaultSeasonAndRubrics(database);
    await seedNextSeason(database);
}
