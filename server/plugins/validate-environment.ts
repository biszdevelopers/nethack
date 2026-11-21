import {
    isLoopbackHost,
    isLoopbackHttpOrigin,
    isValidE2ELoopbackOrigin,
    isValidProductionOrigin,
    isValidTrustedProxyHops,
} from "../utils/environment-validation";

export default defineNitroPlugin(() => {
    const sessionPassword = process.env.BASIS_AUTH_COOKIE_SECRET;
    const isProduction = process.env.NODE_ENV === "production";
    const sessionPasswordLength = sessionPassword
        ? new TextEncoder().encode(sessionPassword).length
        : 0;

    if (!sessionPassword || sessionPasswordLength < 32) {
        const reason = sessionPassword
            ? `only ${sessionPasswordLength} bytes (must be at least 32 bytes)`
            : "not set";
        if (isProduction) {
            console.error(
                `[FATAL] BASIS_AUTH_COOKIE_SECRET is ${reason}. ` +
                    "Set it to a strong secret (e.g. openssl rand -base64 32) and restart the server.",
            );
            process.exit(1);
        } else {
            console.warn(
                `[WARNING] BASIS_AUTH_COOKIE_SECRET is ${reason}. ` +
                    "Session encryption will be weak or unavailable until it is configured.",
            );
        }
    }

    const basisAuthVariables = [
        "BASIS_AUTH_ISSUER",
        "BASIS_AUTH_CLIENT_ID",
        "BASIS_AUTH_CLIENT_SECRET",
        "BASIS_AUTH_RESOURCE",
    ] as const;
    const missingBasisAuthVariables = basisAuthVariables.filter((name) => !process.env[name]);
    if (missingBasisAuthVariables.length > 0) {
        const message = `Missing basis-auth configuration: ${missingBasisAuthVariables.join(", ")}`;
        if (isProduction) {
            console.error(`[FATAL] ${message}`);
            process.exit(1);
        } else {
            console.warn(`[WARNING] ${message}`);
        }
    }

    // basis-auth requires a verified backchannel logout URL before sign-in
    // works, and revocation events arrive through it. Without the private
    // listener settings this resource cannot answer either.
    const resourceSecret = process.env.BASIS_AUTH_RESOURCE_SECRET;
    const internalUrl = process.env.BASIS_AUTH_INTERNAL_URL;
    const missingBackchannel = [
        !resourceSecret && "BASIS_AUTH_RESOURCE_SECRET",
        !internalUrl && "BASIS_AUTH_INTERNAL_URL",
    ]
        .filter(Boolean)
        .join(", ");
    if (missingBackchannel) {
        const message =
            `Missing basis-auth backchannel configuration: ${missingBackchannel}. ` +
            "Sign-in fails with 14408 until the resource has a verified logout URL.";
        // A loopback origin cannot serve a public webhook, so treat it as a
        // local instance even when Nitro inlines NODE_ENV=production.
        if (isProduction && !isLoopbackHttpOrigin(process.env.CURRENT_URL_ORIGIN)) {
            console.error(`[FATAL] ${message}`);
            process.exit(1);
        } else {
            console.warn(`[WARNING] ${message}`);
        }
    } else {
        try {
            const parsed = new URL(internalUrl!);
            if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("protocol");
        } catch {
            const message = "BASIS_AUTH_INTERNAL_URL must be an HTTP or HTTPS URL.";
            if (isProduction) {
                console.error(`[FATAL] ${message}`);
                process.exit(1);
            } else {
                console.warn(`[WARNING] ${message}`);
            }
        }
    }

    if (isProduction) {
        const origin = process.env.CURRENT_URL_ORIGIN;
        const effectiveHost = process.env.NITRO_HOST || process.env.HOST;
        const isIsolatedE2EOrigin =
            process.env.BASISHACKS_E2E === "1" &&
            isValidE2ELoopbackOrigin(
                origin,
                process.env.NITRO_HOST || process.env.HOST,
                process.env.NITRO_PORT || process.env.PORT,
                process.env.NITRO_UNIX_SOCKET,
            );
        const allowedOrigin =
            (isValidProductionOrigin(origin) &&
                (!isLoopbackHttpOrigin(origin) ||
                    (isLoopbackHost(effectiveHost) && !process.env.NITRO_UNIX_SOCKET))) ||
            isIsolatedE2EOrigin;
        if (!allowedOrigin) {
            console.error(
                "[FATAL] CURRENT_URL_ORIGIN must be a public HTTPS origin, or a loopback HTTP origin while the server binds to loopback, without a path, query, or credentials.",
            );
            process.exit(1);
        }
    }

    if (!isValidTrustedProxyHops(process.env.TRUSTED_PROXY_HOPS)) {
        const message = "TRUSTED_PROXY_HOPS must be an integer from 0 to 10.";
        if (isProduction) {
            console.error(`[FATAL] ${message}`);
            process.exit(1);
        } else {
            console.warn(`[WARNING] ${message}`);
        }
    } else if (isProduction && Number(process.env.TRUSTED_PROXY_HOPS ?? 0) === 0) {
        // The hop count cannot be detected from the app. Behind nginx, leaving
        // this at 0 collapses every client into the proxy's single IP bucket.
        console.warn(
            "[WARNING] TRUSTED_PROXY_HOPS is 0 in production. If exactly one reverse proxy " +
                "sits in front of this app, set TRUSTED_PROXY_HOPS=1 so per-IP rate limits " +
                "see real client addresses.",
        );
    }

    const requireVerifiedEmail = ["1", "true", "yes", "on"].includes(
        process.env.REQUIRE_VERIFIED_EMAIL?.trim().toLowerCase() ?? "",
    );
    if (isProduction && !requireVerifiedEmail) {
        // An omitted claim is accepted in the default mode; an explicit false
        // is always rejected. Warn without logging any address.
        console.warn(
            "[WARNING] REQUIRE_VERIFIED_EMAIL is disabled in production. " +
                "Accounts are accepted when the identity provider omits the email_verified claim.",
        );
    }
});
