import { Readable } from "node:stream";
import { NethackPermissions } from "~~/shared/permissions";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";
import { snapshotDatabaseExport } from "~~/server/utils/database-export";
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

        // Export one consistent snapshot: a page-by-page read without a
        // transaction can omit or duplicate rows while the database changes.
        const chunks: string[] = [];
        await event.context.drizzle.transaction(
            async (tx) => {
                for await (const chunk of snapshotDatabaseExport(tx, query.format)) {
                    chunks.push(chunk);
                }
            },
            { isolationLevel: "repeatable read", accessMode: "read only" },
        );

        return sendStream(event, Readable.from(chunks));
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
