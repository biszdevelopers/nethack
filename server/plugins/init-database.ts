import { closeDatabase, createDrizzleDatabase, setDatabaseInitialization } from "../database";
import type { DrizzleDatabase } from "../database";
import { createAndMigrateDatabase } from "../database/migrate";
import { collectOrphanProfileAssets } from "../utils/assets";

const INITIAL_PROFILE_ASSET_GC_DELAY_MS = 60 * 1000;
const PROFILE_ASSET_GC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const PROFILE_ASSET_GC_MAX_SCANNED = 250;
const PROFILE_ASSET_GC_MAX_DELETIONS = 25;

export default defineNitroPlugin((nitroApp) => {
    let database: DrizzleDatabase | undefined;
    const initialization = (async () => {
        try {
            const initializedDatabase = await createDrizzleDatabase();
            database = initializedDatabase;
            await createAndMigrateDatabase(initializedDatabase);
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
        let gcTimer: ReturnType<typeof setTimeout> | undefined;
        let activeGc: Promise<void> | undefined;
        let closing = false;

        const scheduleGc = (delay: number) => {
            if (closing) return;
            gcTimer = setTimeout(() => {
                gcTimer = undefined;
                void runGc();
            }, delay);
            gcTimer.unref?.();
        };

        const runGc = (): Promise<void> => {
            if (activeGc) return activeGc;
            if (closing || !database) return Promise.resolve();

            activeGc = (async () => {
                try {
                    const result = await collectOrphanProfileAssets(database!, {
                        maxScanned: PROFILE_ASSET_GC_MAX_SCANNED,
                        maxDeletions: PROFILE_ASSET_GC_MAX_DELETIONS,
                    });
                    console.info("[Nitro] Profile asset cleanup complete", {
                        entriesVisited: result.entriesVisited,
                        scanned: result.scanned,
                        deleted: result.deleted,
                        referenced: result.referenced,
                        tooRecent: result.tooRecent,
                        staleTemporaryFilesDeleted: result.staleTemporaryFilesDeleted,
                    });
                } catch {
                    // Never log driver errors or query text; they can contain credentials or data.
                    console.warn("[Nitro] Profile asset cleanup failed", {
                        error: "sanitized",
                        scanned: 0,
                        deleted: 0,
                    });
                } finally {
                    activeGc = undefined;
                    if (!closing) scheduleGc(PROFILE_ASSET_GC_INTERVAL_MS);
                }
            })();
            return activeGc;
        };

        scheduleGc(INITIAL_PROFILE_ASSET_GC_DELAY_MS);
        nitroApp.hooks.hook("close", async () => {
            closing = true;
            if (gcTimer) clearTimeout(gcTimer);
            gcTimer = undefined;
            await activeGc;
            await closeDatabase();
        });
    });
});
