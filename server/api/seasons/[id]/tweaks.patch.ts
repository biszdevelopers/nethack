import type { H3Event } from "h3";
import { PositiveIntParam, UpdateSeasonTweaksRequest } from "~~/shared/schemas";
import { NethackPermissions } from "~~/shared/permissions";

const booleanFields = ["show_scores", "show_ranking"] as const;

function parseSeasonId(event: H3Event): number {
    const raw = getRouterParam(event, "id");
    if (!raw || !/^\d+$/.test(raw)) {
        throw createError({ statusCode: 400, statusMessage: "Invalid season ID" });
    }
    const parsed = PositiveIntParam.safeParse(raw);
    if (!parsed.success) {
        throw createError({ statusCode: 400, statusMessage: "Invalid season ID" });
    }
    return parsed.data;
}

export default defineEventHandler(
    applyRateLimit(async (event) => {
        await requireUser(event, NethackPermissions.Seasons.update);

        const id = parseSeasonId(event);

        const body = await readValidatedBody(event, UpdateSeasonTweaksRequest.parse);
        const existing = await getSeasonById(event, id);
        // Live visibility switches need the live-event grant in addition to
        // the season editor grant. A missing season falls through to the
        // updater's not-found result.
        if (existing?.is_active === 1) {
            await requireUser(event, NethackPermissions.Hackathon.update);
        }

        const data: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(body)) {
            if (value === undefined) continue;
            data[key] = booleanFields.includes(key as (typeof booleanFields)[number])
                ? value
                    ? 1
                    : 0
                : value;
        }

        const updated = await updateSeasonTweaks(event, id, data);
        if (!updated) {
            throw createError({
                statusCode: 404,
                message: "Season not found",
            });
        }

        return { message: "Season tweaks updated" };
    }),
);
