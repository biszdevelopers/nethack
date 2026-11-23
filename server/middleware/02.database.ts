import { getDb } from "~~/server/database";

const HEALTH_PREFIX = "/api/health";

/** Attach the process-wide Drizzle instance to each H3 request before routing. */
export default defineEventHandler(async (event) => {
    const pathname = String(event.path ?? "").split("?")[0] ?? "";
    // Health probes must answer during startup and when the pool is unhealthy;
    // the readiness route reads the client directly with its own deadline.
    if (pathname === HEALTH_PREFIX || pathname.startsWith(`${HEALTH_PREFIX}/`)) return;
    event.context.drizzle = await getDb();
});
