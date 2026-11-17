import { setResponseHeader } from "h3";
import { applyRateLimit, AUTH_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";
import { completeBasisAuthFlow, sanitizePostLoginRedirect } from "~~/server/utils/basis-auth";
import {
    consumeBasisAuthFlowTransaction,
    establishBasisAuthUserSession,
} from "~~/server/utils/basis-auth-session";
import { findOrLinkBasisAuthUser } from "~~/server/utils/database/users";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        if (event.node?.res) setResponseHeader(event, "cache-control", "no-store");
        const transaction = consumeBasisAuthFlowTransaction(event);

        try {
            const result = await completeBasisAuthFlow(getRequestURL(event), transaction);
            const user = await findOrLinkBasisAuthUser(event, result.identity);

            // A login started while signed in must not silently replace that
            // session with a different account (login CSRF / session fixation).
            if (
                transaction.preLoginUserId !== undefined &&
                transaction.preLoginUserId !== user.id
            ) {
                throw createError({
                    statusCode: 409,
                    message: "This login flow belongs to a different session.",
                });
            }

            establishBasisAuthUserSession(event, user.id, {
                accessToken: result.tokens.accessToken,
                accessTokenExpiresAt: result.tokens.expiresAt,
                refreshToken: result.tokens.refreshToken,
            });

            return await sendRedirect(
                event,
                sanitizePostLoginRedirect(transaction.postLoginRedirect) || "/dashboard",
                302,
            );
        } catch (error) {
            console.error(
                "basis-auth callback failed:",
                error instanceof Error ? error.message : "unknown error",
            );
            throw createError({
                statusCode: 401,
                statusMessage: "Authentication failed",
                message: "Unable to complete login. Please try again.",
            });
        }
    }, AUTH_RATE_LIMIT_CONFIG),
);
