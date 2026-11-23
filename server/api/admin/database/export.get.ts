import { NethackPermissions } from "~~/shared/permissions";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";
import { streamDatabaseExport } from "~~/server/utils/database-export-stream";
import { sendStream } from "h3";
import { z } from "zod";

const ExportQuery = z.object({ format: z.enum(["json", "csv"]).default("json") });

export default defineEventHandler(
    applyRateLimit(async (event) => {
        await requireUser(event, NethackPermissions.Database.export);
        const query = await getValidatedQuery(event, ExportQuery.parse);

        setResponseHeader(event, "Cache-Control", "no-store");
        setResponseHeader(
            event,
            "Content-Type",
            query.format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
        );
        setResponseHeader(
            event,
            "Content-Disposition",
            `attachment; filename="nethack-export.${query.format}"`,
        );

        const overrides = await getLiveOverrides(event);
        return sendStream(
            event,
            streamDatabaseExport(event.context.drizzle, query.format, overrides),
        );
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
