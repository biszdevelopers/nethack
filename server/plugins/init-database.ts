import { closeDatabase, createDrizzleDatabase, setDatabaseInitialization } from "../database";
import { createAndMigrateDatabase } from "../database/migrate";

export default defineNitroPlugin((nitroApp) => {
    const initialization = (async () => {
        try {
            const db = await createDrizzleDatabase();
            await createAndMigrateDatabase(db);
        } catch (error) {
            try {
                await closeDatabase();
            } catch (closeError) {
                console.error(
                    "[Nitro] Failed to close PostgreSQL after database initialization failed",
                    closeError,
                );
            }
            throw error;
        }
    })();
    setDatabaseInitialization(initialization);

    return initialization.then(() => {
        console.log("[Nitro] PostgreSQL database ready (Drizzle ORM)");
        nitroApp.hooks.hook("close", async () => {
            await closeDatabase();
        });
    });
});
