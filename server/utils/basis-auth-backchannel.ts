import { createHmac } from "node:crypto";
import type { H3Event } from "h3";
import type { JWTPayload } from "jose";
import { getBasisAuthConfig, getBasisAuthInternalConfig } from "./basis-auth";
import { verifyBasisAuthJwt } from "./basis-auth-jwks";
import { endBasisAuthSubjectSessions, revokeAccessToken } from "./basis-auth-state";

const BACKCHANNEL_LOGOUT_EVENT = "http://schemas.openid.net/event/backchannel-logout";
const noncePattern = /^[A-Za-z0-9_-]{43}$/;

function rejectBackchannel(message: string): never {
    throw createError({ statusCode: 400, statusMessage: "invalid_request", message });
}

async function verifyEventToken(token: string, typ: string): Promise<JWTPayload> {
    try {
        return await verifyBasisAuthJwt(token, {
            typ,
            audience: getBasisAuthConfig().resource,
        });
    } catch {
        return rejectBackchannel(`The ${typ} event token is invalid`);
    }
}

/**
 * Prove control of the registered resource to basis-auth. The receiver answers
 * 202 first, so this runs after the response and only logs its own failures.
 */
export async function sendBasisAuthWebhookProof(nonce: string, challenge: string): Promise<void> {
    const config = getBasisAuthInternalConfig();
    if (!config) {
        console.warn(
            "basis-auth webhook verification skipped: BASIS_AUTH_INTERNAL_URL and BASIS_AUTH_RESOURCE_SECRET are not configured",
        );
        return;
    }
    const challengeHash = createHmac("sha256", config.resourceSecret)
        .update(challenge, "utf8")
        .digest("hex");
    const response = await fetch(new URL("/internal/backchannel/validate", config.internalUrl), {
        method: "POST",
        headers: {
            authorization: `Bearer ${config.resourceSecret}`,
            "x-basis-resource": encodeURIComponent(getBasisAuthConfig().resource),
            "content-type": "application/json",
        },
        body: JSON.stringify({ nonce, challenge_hash: challengeHash }),
        signal: AbortSignal.timeout(8000),
    });
    await response.body?.cancel();
    if (!response.ok) {
        console.warn(`basis-auth webhook proof was rejected with ${response.status}`);
    }
}

/** Validate and dispatch the `action=test` webhook challenge. */
export function handleBackchannelTest(form: URLSearchParams): void {
    const nonce = form.get("nonce");
    const challenge = form.get("challenge");
    if (!nonce || !challenge || !noncePattern.test(nonce) || !noncePattern.test(challenge)) {
        rejectBackchannel("The webhook challenge is invalid");
    }
    void sendBasisAuthWebhookProof(nonce, challenge).catch(() => {
        // The operator can save the URL again; do not fail the 202 response.
    });
}

/** Verify a backchannel logout token and end the matching local sessions. */
export async function applyBasisAuthLogoutToken(event: H3Event, token: string): Promise<void> {
    const payload = await verifyEventToken(token, "logout+jwt");
    const events = payload.events;
    if (
        typeof payload.sub !== "string" ||
        !payload.sub ||
        !events ||
        typeof events !== "object" ||
        !(BACKCHANNEL_LOGOUT_EVENT in events)
    ) {
        rejectBackchannel("The logout token is missing required claims");
    }
    await endBasisAuthSubjectSessions(event, payload.sub);
}

/** Verify an access-token revocation event and add its jti to the denylist. */
export async function applyBasisAuthAccessTokenRevocation(
    event: H3Event,
    form: URLSearchParams,
): Promise<void> {
    const jti = form.get("jti");
    const validAfterText = form.get("valid_after");
    const token = form.get("revocation_token");
    const validAfter =
        validAfterText && /^\d+$/.test(validAfterText) ? Number(validAfterText) : NaN;
    if (!jti || !token || !Number.isSafeInteger(validAfter)) {
        rejectBackchannel("The revocation event is invalid");
    }

    const payload = await verifyEventToken(token, "at-revocation+jwt");
    if (payload.access_token_jti !== jti || payload.valid_after !== validAfter) {
        rejectBackchannel("The revocation token does not match the event");
    }
    const expiresAt = payload.access_token_expires_at;
    await revokeAccessToken(event, {
        jti,
        validAfter,
        expiresAt: typeof expiresAt === "number" && Number.isFinite(expiresAt) ? expiresAt : null,
    });
}
