import {
    applyBasisAuthAccessTokenRevocation,
    applyBasisAuthLogoutToken,
    handleBackchannelTest,
} from "~~/server/utils/basis-auth-backchannel";
import { applyRateLimit } from "~~/server/utils/rateLimit";

/**
 * basis-auth resource receiver: webhook verification, logout tokens, and
 * access-token revocations all arrive here as form-encoded POSTs.
 */
export default defineEventHandler(
    applyRateLimit(async (event) => {
        setResponseHeader(event, "cache-control", "no-store");
        const form = new URLSearchParams((await readRawBody(event, "utf8")) ?? "");

        if (form.get("action") === "test") {
            handleBackchannelTest(form);
            setResponseStatus(event, 202);
            return { status: "accepted" };
        }

        const logoutToken = form.get("logout_token");
        if (logoutToken) {
            await applyBasisAuthLogoutToken(event, logoutToken);
            setResponseStatus(event, 204);
            return null;
        }

        if (form.get("action") === "revoke_access_token") {
            await applyBasisAuthAccessTokenRevocation(event, form);
            setResponseStatus(event, 204);
            return null;
        }

        throw createError({
            statusCode: 400,
            statusMessage: "invalid_request",
            message: "Unsupported backchannel event",
        });
    }),
);
