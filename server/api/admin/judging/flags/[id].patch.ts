import { NethackPermissions } from "~~/shared/permissions";
import { JudgeFlagIdParams } from "~~/shared/schemas";
import { resolveJudgeFlag } from "~~/server/utils/database/judge-flags";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        const admin = await requireUser(event, NethackPermissions.all);
        const { id } = await getValidatedRouterParams(event, JudgeFlagIdParams.parse);
        await resolveJudgeFlag(event, id, admin.id);
        return { message: "Flag resolved" };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
