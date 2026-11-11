import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { asc, desc, eq } from "drizzle-orm";
import type { Sql } from "postgres";
import { getPostgresClient, type DrizzleDatabase } from "./index";
import { hackathon, rubricTemplates, rubricVersions, seasons } from "./schema";
import { DEFAULT_RUBRIC_DEFINITION } from "../../shared/rubric";

const MIGRATIONS_FOLDER = resolve(process.cwd(), "drizzle/postgres");
const MIGRATION_LOCK_ID = BigInt("75110114284009");

/** Apply generated PostgreSQL migrations while serializing concurrent startups. */
export async function migrateDatabase(
    database: DrizzleDatabase,
    migrationsFolder: string = MIGRATIONS_FOLDER,
    client: Sql = getPostgresClient(),
): Promise<void> {
    // Keep the advisory lock on a pinned connection while Drizzle applies its
    // transactional migrations through the bounded pool. The pool must have at
    // least two connections for the lock and migration sessions.
    await client.begin(async (connection) => {
        await connection`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK_ID})`;
        await migrate(database, { migrationsFolder });
    });
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

/** Seed a usable first season and attach immutable default rubric versions. */
export async function seedDefaultSeasonAndRubrics(database: DrizzleDatabase): Promise<void> {
    await database.transaction(async (tx) => {
        const seasonRows = await tx.select().from(seasons).orderBy(asc(seasons.id));
        if (seasonRows.length === 0) {
            await tx
                .insert(seasons)
                .values({ id: 1, name: "Season 1", is_active: 1 })
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

/** Migrate and seed before Nitro begins accepting requests. */
export async function createAndMigrateDatabase(database: DrizzleDatabase): Promise<void> {
    await migrateDatabase(database);
    await seedHackathon(database);
    await seedDefaultSeasonAndRubrics(database);
}
