import { APIError } from "@basis/schema/api";
import { setResponseHeader } from "h3";
import { getFreshBasisAuthUserSession } from "~~/server/utils/basis-auth";
import { clearBasisAuthUserSession } from "~~/server/utils/basis-auth-session";
import { getUser } from "~~/server/utils/database/users";
import { verifyAccessToken } from "~~/server/utils/oauth2-jwt";
import { applyRateLimit, AUTH_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";
import { effectiveNethackPermissions } from "~~/server/utils/effective-permissions";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        if (event.node?.res) setResponseHeader(event, "cache-control", "no-store");
        const session = await getFreshBasisAuthUserSession(event);
        if (!session) {
            clearBasisAuthUserSession(event);
            throw new APIError("invalid_token", "Invalid access token", 401);
        }

        try {
            const payload = await verifyAccessToken(session.tokens.accessToken, event);
            const user = await getUser(event, session.userId);
            if (!user) {
                // The local account was removed; do not keep reporting a valid
                // session that every protected route will reject. The catch
                // below clears the stale cookie.
                throw new APIError("invalid_token", "Invalid access token", 401);
            }
            return {
                user: { id: session.userId },
                expiresAt: session.tokens.accessTokenExpiresAt,
                permissions: effectiveNethackPermissions(payload.permissions, user),
            };
        } catch (error) {
            clearBasisAuthUserSession(event);
            throw error;
        }
    }, AUTH_RATE_LIMIT_CONFIG),
);
