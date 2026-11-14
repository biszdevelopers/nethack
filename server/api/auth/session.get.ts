import { APIError } from "@basis/schema/api";
import { setResponseHeader } from "h3";
import { getFreshBasisAuthUserSession } from "~~/server/utils/basis-auth";
import { clearBasisAuthUserSession } from "~~/server/utils/basis-auth-session";
import { verifyAccessToken } from "~~/server/utils/oauth2-jwt";
import { applyRateLimit, AUTH_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";
import { effectiveNethackPermissions } from "~~/shared/permissions";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        if (event.node?.res) setResponseHeader(event, "cache-control", "no-store");
        const session = await getFreshBasisAuthUserSession(event);
        if (!session) {
            clearBasisAuthUserSession(event);
            throw new APIError("invalid_token", "The login session has expired", 401);
        }

        try {
            const payload = await verifyAccessToken(session.tokens.accessToken);
            const user = await getUser(event, session.userId);
            return {
                user: { id: session.userId },
                expiresAt: session.tokens.accessTokenExpiresAt,
                permissions: effectiveNethackPermissions(payload.permissions, user ?? undefined),
            };
        } catch (error) {
            clearBasisAuthUserSession(event);
            throw error;
        }
    }, AUTH_RATE_LIMIT_CONFIG),
);
