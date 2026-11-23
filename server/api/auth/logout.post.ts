import { setResponseHeader } from "h3";
import { revokeBasisAuthToken } from "~~/server/utils/basis-auth";
import {
    clearBasisAuthUserSession,
    readBasisAuthUserSession,
} from "~~/server/utils/basis-auth-session";
import { applyRateLimit, AUTH_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        if (event.node?.res) setResponseHeader(event, "cache-control", "no-store");
        try {
            const session = readBasisAuthUserSession(event);
            if (session?.tokens.refreshToken) {
                await revokeBasisAuthToken(session.tokens.refreshToken);
            }
        } catch {
            console.warn("basis-auth token revocation failed");
        } finally {
            clearBasisAuthUserSession(event);
        }
        return { loggedOut: true };
    }, AUTH_RATE_LIMIT_CONFIG),
);
