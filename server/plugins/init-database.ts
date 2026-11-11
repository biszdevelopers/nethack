import { closeDatabase, createDrizzleDatabase } from "../database";
import { createAndMigrateDatabase } from "../database/migrate";

export default defineNitroPlugin(async (nitroApp) => {
    const db = await createDrizzleDatabase();
    await createAndMigrateDatabase(db);
    console.log("[Nitro] PostgreSQL database ready (Drizzle ORM)");

    nitroApp.hooks.hook("close", async () => {
        await closeDatabase();
    });
});
