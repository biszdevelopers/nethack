import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";
import { SetActiveSeasonRequest } from "~~/shared/schemas";
import { NethackPermissions } from "~~/shared/permissions";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        await requireUser(event, NethackPermissions.Seasons.activate);
        const body = await readValidatedBody(event, SetActiveSeasonRequest.parse);
        await setActiveSeason(event, body.season_id);
        return { message: "Active season updated" };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
