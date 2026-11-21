import { NethackPermissions } from "~~/shared/permissions";
import { AdminJudgeFlagQuery } from "~~/shared/schemas";
import { getJudgeFlags } from "~~/server/utils/database/judge-flags";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        await requireUser(event, NethackPermissions.all);
        const query = await getValidatedQuery(event, AdminJudgeFlagQuery.parse);
        const flags = await getJudgeFlags(event.context.drizzle, {
            seasonId: query.season_id,
            resolved: query.resolved,
        });
        return {
            flags: flags.map((flag) => ({
                ...flag,
                resolved_at: flag.resolved_at?.toISOString() ?? null,
                created_at: flag.created_at.toISOString(),
            })),
        } satisfies GetJudgeFlagsResponse;
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
