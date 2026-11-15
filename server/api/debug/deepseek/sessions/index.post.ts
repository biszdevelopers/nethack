import { createSession } from "~~/server/utils/deepseek-store";
import { requireUser } from "~~/server/utils/auth";
import { NethackPermissions } from "~~/shared/permissions";
import z from "zod";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

const CreateDeepSeekSessionRequest = z.object({
    sessionName: z.string().min(1).max(100, "Session name is too long"),
});

export default defineEventHandler(
    applyRateLimit(async (event) => {
        const user = await requireUser(event, NethackPermissions.Debug.deepseekWrite);

        const { sessionName } = await readValidatedBody(event, CreateDeepSeekSessionRequest.parse);

        try {
            const session = createSession(sessionName, user.id);
            return session;
        } catch (error: any) {
            console.error("Error creating deepseek session:", error);
            throw createError({
                statusCode: 500,
                statusMessage: "Failed to create session",
            });
        }
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
