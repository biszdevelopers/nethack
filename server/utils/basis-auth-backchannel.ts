import { createHmac } from "node:crypto";
import { createError } from "h3";
import { z } from "zod";
import { ACCESS_TOKEN_CLOCK_TOLERANCE_SECONDS, verifyBasisAuthJWT } from "./basis-auth-jwt";
import type { BasisAuthConfig } from "./basis-auth";

const CHALLENGE_TIMEOUT_MS = 8_000;
const HOUR_SECONDS = 3600;
const unixSeconds = z.int().nonnegative();
const challengePart = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const testForm = z.object({
    action: z.literal("test"),
    nonce: challengePart,
    challenge: challengePart,
});
const revocationForm = z.object({
    action: z.literal("revoke_access_token"),
    jti: z.string().min(1),
    valid_after: z.string().regex(/^(0|[1-9]\d*)$/),
    revocation_token: z.string().min(1),
});
const logoutForm = z.object({
    action: z.undefined().optional(),
    logout_token: z.string().min(1),
});
export const basisBackchannelForm = z.union([testForm, revocationForm, logoutForm]);

const revocationClaims = z.object({
    iat: unixSeconds,
    exp: unixSeconds,
    access_token_jti: z.string().min(1),
    valid_after: unixSeconds,
    access_token_expires_at: unixSeconds.nullable(),
});
const logoutClaims = z.object({
    sub: z.string().min(1),
    iat: unixSeconds,
    jti: z.string().min(1),
    exp: unixSeconds,
    events: z.object({
        "http://schemas.openid.net/event/backchannel-logout": z.object({}),
    }),
});

export async function validateRevocation(
    form: z.infer<typeof revocationForm>,
    config: BasisAuthConfig,
) {
    const { protectedHeader, payload } = await verifyBasisAuthJWT(
        form.revocation_token,
        config,
        "at-revocation+jwt",
    );
    const claims = revocationClaims.parse(payload);
    if (
        protectedHeader.typ !== "at-revocation+jwt" ||
        claims.access_token_jti !== form.jti ||
        String(claims.valid_after) !== form.valid_after
    ) {
        throw new Error("Invalid revocation event");
    }
    return claims;
}

export async function validateSubjectLogout(
    form: z.infer<typeof logoutForm>,
    config: BasisAuthConfig,
) {
    const { protectedHeader, payload } = await verifyBasisAuthJWT(
        form.logout_token,
        config,
        "logout+jwt",
    );
    const claims = logoutClaims.parse(payload);
    if (protectedHeader.typ !== "logout+jwt" || claims.iat > Math.floor(Date.now() / 1000)) {
        throw new Error("Invalid logout event");
    }
    return claims;
}

export function revocationRetentionDeadline(claims: z.infer<typeof revocationClaims>) {
    const fallback = z.coerce
        .number()
        .int()
        .positive()
        .parse(process.env.BASIS_AUTH_ACCESS_TOKEN_LIFETIME_SECONDS ?? HOUR_SECONDS);
    return Math.max(
        claims.iat + HOUR_SECONDS,
        claims.valid_after,
        (claims.access_token_expires_at ?? claims.iat + fallback) +
            ACCESS_TOKEN_CLOCK_TOLERANCE_SECONDS,
    );
}

export function getBackchannelProofConfig() {
    const resourceSecret = process.env.BASIS_AUTH_RESOURCE_SECRET;
    const url = URL.parse(process.env.BASIS_AUTH_INTERNAL_URL ?? "");
    if (
        !resourceSecret ||
        !url ||
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password
    ) {
        throw createError({ statusCode: 503, message: "Basis Auth backchannel is unconfigured" });
    }
    return { resourceSecret, url: new URL("/internal/backchannel/validate", url) };
}

export async function submitBackchannelProof(
    form: z.infer<typeof testForm>,
    audience: string,
    { resourceSecret, url }: ReturnType<typeof getBackchannelProofConfig>,
) {
    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${resourceSecret}`,
                "X-Basis-Resource": encodeURIComponent(audience),
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                nonce: form.nonce,
                challenge_hash: createHmac("sha256", resourceSecret)
                    .update(form.challenge, "utf8")
                    .digest("hex"),
            }),
            signal: AbortSignal.timeout(CHALLENGE_TIMEOUT_MS),
            redirect: "error",
        });
        if (response.status !== 200 || (await response.json())?.status !== "successful") {
            console.warn("[Basis Auth] Backchannel proof rejected");
        }
    } catch {
        console.warn("[Basis Auth] Backchannel proof submission failed");
    }
}
