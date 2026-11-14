import { UpdateSeasonTweaksRequest } from "~~/shared/schemas";
import { NethackPermissions } from "~~/shared/permissions";

const booleanFields = ["show_scores", "show_ranking"] as const;

export default defineEventHandler(
    applyRateLimit(async (event) => {
        await requireUser(event, NethackPermissions.Seasons.update);

        const rawId = getRouterParam(event, "id");
        if (!rawId || !/^\d+$/.test(rawId)) {
            throw createError({ statusCode: 400, message: "Invalid season ID" });
        }

        const id = Number(rawId);
        if (!Number.isSafeInteger(id) || id < 1) {
            throw createError({ statusCode: 400, message: "Invalid season ID" });
        }

        const body = await readValidatedBody(event, UpdateSeasonTweaksRequest.parse);

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
