import { asc } from "drizzle-orm";
import { NethackPermissions } from "~~/shared/permissions";
import { awards } from "~~/server/database/schema";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        await requireUser(event, NethackPermissions.all);
        const rows = await event.context.drizzle
            .select()
            .from(awards)
            .orderBy(asc(awards.namespace));
        return { awards: rows };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
