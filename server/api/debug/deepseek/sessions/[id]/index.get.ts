import { getDeepSeekSession } from "~~/server/utils/deepseek-store";
import { requireUser } from "~~/server/utils/auth";
import { NethackPermissions } from "~~/shared/permissions";
import { DeepSeekSessionIdParams } from "~~/shared/schemas";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        const user = await requireUser(event, NethackPermissions.Debug.deepseekRead);

        const { id: sessionId } = await getValidatedRouterParams(
            event,
            DeepSeekSessionIdParams.parse,
        );

        try {
            const session = getDeepSeekSession(sessionId);

            if (!session || session.owner_user_id !== user.id) {
                throw createError({
                    statusCode: 404,
                    statusMessage: "Session not found",
                });
            }

            return session;
        } catch (error: any) {
            console.error("Error retrieving deepseek session:", error);
            if (error.statusCode) {
                throw error;
            }
            throw createError({
                statusCode: 500,
                statusMessage: "Failed to retrieve session",
            });
        }
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
