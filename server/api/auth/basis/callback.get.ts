import { setResponseHeader } from "h3";
import { applyRateLimit, AUTH_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";
import { completeBasisAuthFlow, sanitizePostLoginRedirect } from "~~/server/utils/basis-auth";
import {
    clearBasisAuthUserSession,
    consumeBasisAuthFlowTransaction,
    establishBasisAuthUserSession,
} from "~~/server/utils/basis-auth-session";
import { getUser, findOrLinkBasisAuthUser } from "~~/server/utils/database/users";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        if (event.node?.res) setResponseHeader(event, "cache-control", "no-store");
        const transaction = consumeBasisAuthFlowTransaction(event);

        try {
            const result = await completeBasisAuthFlow(getRequestURL(event), transaction);

            // A login started while signed in must not silently replace that
            // session with a different account (login CSRF / session fixation).
            // Check before linking, so a rejected flow cannot create or mutate
            // a local user row for the other identity.
            if (transaction.preLoginUserId !== undefined) {
                const preLoginUser = await getUser(event, transaction.preLoginUserId);
                if (!preLoginUser) {
                    // The local account was removed while its token cookie was
                    // still present. Treat this as a fresh login instead of
                    // trapping the browser in a permanent session-mismatch loop.
                    clearBasisAuthUserSession(event);
                } else if (
                    preLoginUser.auth_issuer !== result.identity.issuer ||
                    preLoginUser.auth_subject !== result.identity.subject
                ) {
                    throw createError({
                        statusCode: 409,
                        statusMessage: "login_session_mismatch",
                        message: "This login flow belongs to a different session.",
                    });
                }
            }

            const user = await findOrLinkBasisAuthUser(event, result.identity);

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
            if (
                error &&
                typeof error === "object" &&
                "statusMessage" in error &&
                error.statusMessage === "login_session_mismatch"
            ) {
                throw error;
            }
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
