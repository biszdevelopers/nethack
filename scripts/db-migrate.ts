import { closeDatabase, createDrizzleDatabase } from "../server/database";
import { createAndMigrateDatabase } from "../server/database/migrate";

try {
    const database = await createDrizzleDatabase();
    await createAndMigrateDatabase(database);
    console.info("PostgreSQL migrations and seeds are up to date.");
} catch (error) {
    console.error("PostgreSQL migration failed.");
    console.error(error instanceof Error ? error.message : "Unknown migration error");
    process.exitCode = 1;
} finally {
    await closeDatabase();
}
