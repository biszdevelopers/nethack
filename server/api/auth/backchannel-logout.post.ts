import { createError, getHeader, readValidatedBody, sendNoContent } from "h3";
import { getBasisAuthConfig } from "~~/server/utils/basis-auth";
import {
    basisBackchannelForm,
    getBackchannelProofConfig,
    revocationRetentionDeadline,
    submitBackchannelProof,
    validateRevocation,
    validateSubjectLogout,
} from "~~/server/utils/basis-auth-backchannel";
import {
    recordBasisAccessTokenRevocation,
    recordBasisSubjectLogout,
} from "~~/server/utils/database/basis-auth-revocations";

function invalidBackchannelToken() {
    console.warn("[Basis Auth] Backchannel token validation failed");
    return createError({ statusCode: 400, message: "Invalid backchannel token" });
}

export default defineEventHandler(async (event) => {
    const contentType = getHeader(event, "content-type")?.split(";")[0]?.trim().toLowerCase();
    if (contentType !== "application/x-www-form-urlencoded") {
        throw createError({ statusCode: 415, message: "Expected form-encoded data" });
    }
    const form = await readValidatedBody(event, basisBackchannelForm.parse);
    const config = getBasisAuthConfig();
    if (form.action === "test") {
        const proof = getBackchannelProofConfig();
        sendNoContent(event, 202);
        event.waitUntil(submitBackchannelProof(form, config.resource, proof));
        return;
    }

    const db = event.context.drizzle;
    let persist: () => Promise<void>;
    if (form.action === "revoke_access_token") {
        const claims = await validateRevocation(form, config).catch(() => {
            throw invalidBackchannelToken();
        });
        persist = () =>
            recordBasisAccessTokenRevocation(
                db,
                config.issuer,
                claims.access_token_jti,
                claims.valid_after,
                revocationRetentionDeadline(claims),
            );
    } else {
        const claims = await validateSubjectLogout(form, config).catch(() => {
            throw invalidBackchannelToken();
        });
        persist = () => recordBasisSubjectLogout(db, config.issuer, claims.sub, claims.iat);
    }
    try {
        await persist();
    } catch {
        console.error("[Basis Auth] Could not persist backchannel event");
        throw createError({ statusCode: 503, message: "Could not persist backchannel event" });
    }
    return sendNoContent(event, 204);
});
