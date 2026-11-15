import { NethackPermissions } from "~~/shared/permissions";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";
import { getHackathonConfigSource } from "~~/server/utils/hackathon-config";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        await requireUser(event, NethackPermissions.Hackathon.read);

        const hackathonRow = await getHackathon(event);
        const allSeasons = await getSeasons(event);

        const source = getHackathonConfigSource();
        return {
            hackathon: hackathonRow,
            seasons: allSeasons,
            configSource: source === "local" || source === "database" ? source : "remote",
        };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
