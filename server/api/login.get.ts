import { setResponseHeader } from "h3";
import { applyRateLimit, AUTH_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";
import { beginBasisAuthFlow, sanitizePostLoginRedirect } from "~~/server/utils/basis-auth";
import {
    readBasisAuthUserSession,
    writeBasisAuthFlowTransaction,
} from "~~/server/utils/basis-auth-session";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        if (event.node?.res) setResponseHeader(event, "cache-control", "no-store");
        const redirect = sanitizePostLoginRedirect(getQuery(event).redirect);
        const preLoginUserId = readBasisAuthUserSession(event)?.userId;
        const authorizationUrl = await beginBasisAuthFlow(redirect, preLoginUserId);

        writeBasisAuthFlowTransaction(event, authorizationUrl.transaction);
        return await sendRedirect(event, authorizationUrl.url.href, 302);
    }, AUTH_RATE_LIMIT_CONFIG),
);
