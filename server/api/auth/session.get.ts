import { setResponseHeader } from "h3";
import { getFreshBasisAuthUserSession } from "~~/server/utils/basis-auth";
import { invalidAccessToken } from "~~/server/utils/basis-auth-jwt";
import { clearBasisAuthUserSession } from "~~/server/utils/basis-auth-session";
import { getUser } from "~~/server/utils/database/users";
import { applyRateLimit, AUTH_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";
import { effectiveNethackPermissions } from "~~/shared/permissions";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        if (event.node?.res) setResponseHeader(event, "cache-control", "no-store");
        const session = await getFreshBasisAuthUserSession(event);
        if (!session) {
            clearBasisAuthUserSession(event);
            throw invalidAccessToken();
        }

        const user = await getUser(event, session.userId);
        return {
            user: { id: session.userId },
            expiresAt: session.tokens.accessTokenExpiresAt,
            permissions: effectiveNethackPermissions(
                session.payload.permissions,
                user ?? undefined,
            ),
        };
    }, AUTH_RATE_LIMIT_CONFIG),
);
