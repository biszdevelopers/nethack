import { getDb } from "~~/server/database";

/** Attach the process-wide Drizzle instance to each H3 request before routing. */
export default defineEventHandler(async (event) => {
    event.context.drizzle = await getDb();
});
