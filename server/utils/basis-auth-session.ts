import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import type { H3Event } from "h3";
import { isLoopbackHttpOrigin } from "~~/server/utils/environment-validation";

export const BASIS_AUTH_TOKEN_COOKIE = "basis-auth-tokens";
export const BASIS_AUTH_FLOW_COOKIE = "basis-auth-flow";
const TOKEN_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const FLOW_MAX_AGE_SECONDS = 10 * 60;
const COOKIE_VALUE_LIMIT = 3800;
const ENCRYPTION_VERSION = "v1";

export interface StoredBasisAuthTokens {
    accessToken: string;
    accessTokenExpiresAt: number;
    refreshToken: string;
}

export interface BasisAuthUserSession {
    userId: number;
    tokens: StoredBasisAuthTokens;
    issuedAt?: number;
}

export interface BasisAuthFlowTransaction {
    state: string;
    nonce: string;
    codeVerifier: string;
    startedAt: number;
    postLoginRedirect?: string;
}

function cookieSecret(): string {
    const secret = process.env.BASIS_AUTH_COOKIE_SECRET;
    if (!secret || new TextEncoder().encode(secret).length < 32) {
        throw createError({
            statusCode: 500,
            message: "BASIS_AUTH_COOKIE_SECRET must be at least 32 bytes",
        });
    }
    return secret;
}

function encryptionKey(purpose: "tokens" | "flow") {
    return createHash("sha256")
        .update(`basishacks:basis-auth:${purpose}:${cookieSecret()}`)
        .digest();
}

function seal(value: unknown, purpose: "tokens" | "flow"): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", encryptionKey(purpose), iv);
    const plaintext = deflateRawSync(Buffer.from(JSON.stringify(value), "utf8"));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const sealed = [
        ENCRYPTION_VERSION,
        iv.toString("base64url"),
        cipher.getAuthTag().toString("base64url"),
        ciphertext.toString("base64url"),
    ].join(".");
    if (sealed.length > COOKIE_VALUE_LIMIT) {
        throw createError({ statusCode: 500, message: "basis-auth token cookie is too large" });
    }
    return sealed;
}

function unseal(value: string, purpose: "tokens" | "flow"): unknown {
    const [version, encodedIv, encodedTag, encodedCiphertext, extra] = value.split(".");
    if (
        version !== ENCRYPTION_VERSION ||
        !encodedIv ||
        !encodedTag ||
        !encodedCiphertext ||
        extra
    ) {
        throw new Error("Invalid basis-auth cookie");
    }
    const decipher = createDecipheriv(
        "aes-256-gcm",
        encryptionKey(purpose),
        Buffer.from(encodedIv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
    const compressed = Buffer.concat([
        decipher.update(Buffer.from(encodedCiphertext, "base64url")),
        decipher.final(),
    ]);
    return JSON.parse(inflateRawSync(compressed).toString("utf8"));
}

function cookieOptions(maxAge: number) {
    return {
        httpOnly: true,
        // Secure cookies are discarded by browsers over plain HTTP, so keep them
        // available for loopback production instances while public origins stay secure.
        secure:
            process.env.NODE_ENV === "production" &&
            !isLoopbackHttpOrigin(process.env.CURRENT_URL_ORIGIN),
        sameSite: "lax" as const,
        path: "/",
        maxAge,
    };
}

function parseTokens(value: unknown): BasisAuthUserSession | undefined {
    if (!value || typeof value !== "object") return undefined;
    const session = value as Partial<BasisAuthUserSession>;
    const tokens = session.tokens as Partial<StoredBasisAuthTokens> | undefined;
    if (
        !Number.isInteger(session.userId) ||
        (session.issuedAt !== undefined && !Number.isSafeInteger(session.issuedAt)) ||
        !tokens ||
        typeof tokens.accessToken !== "string" ||
        typeof tokens.accessTokenExpiresAt !== "number" ||
        typeof tokens.refreshToken !== "string"
    ) {
        return undefined;
    }
    return session as BasisAuthUserSession;
}

export function establishBasisAuthUserSession(
    event: H3Event,
    userId: number,
    tokens: StoredBasisAuthTokens,
    issuedAt?: number,
): void {
    setCookie(
        event,
        BASIS_AUTH_TOKEN_COOKIE,
        seal({ userId, tokens, issuedAt }, "tokens"),
        cookieOptions(TOKEN_MAX_AGE_SECONDS),
    );
}

export function readBasisAuthUserSession(event: H3Event): BasisAuthUserSession | undefined {
    const value = getCookie(event, BASIS_AUTH_TOKEN_COOKIE);
    if (!value) return undefined;
    try {
        return parseTokens(unseal(value, "tokens"));
    } catch {
        return undefined;
    }
}

export function clearBasisAuthUserSession(event: H3Event): void {
    deleteCookie(event, BASIS_AUTH_TOKEN_COOKIE, { path: "/" });
}

export function writeBasisAuthFlowTransaction(
    event: H3Event,
    transaction: BasisAuthFlowTransaction,
): void {
    setCookie(
        event,
        BASIS_AUTH_FLOW_COOKIE,
        seal(transaction, "flow"),
        cookieOptions(FLOW_MAX_AGE_SECONDS),
    );
}

export function consumeBasisAuthFlowTransaction(event: H3Event): Partial<BasisAuthFlowTransaction> {
    const value = getCookie(event, BASIS_AUTH_FLOW_COOKIE);
    deleteCookie(event, BASIS_AUTH_FLOW_COOKIE, { path: "/" });
    if (!value) return {};
    try {
        const parsed = unseal(value, "flow");
        return parsed && typeof parsed === "object" ? (parsed as BasisAuthFlowTransaction) : {};
    } catch {
        return {};
    }
}
