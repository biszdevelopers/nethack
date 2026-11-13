import {
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

    const msTenantId = process.env.MICROSOFT_TENANT_ID;
    const msClientId = process.env.MICROSOFT_CLIENT_ID;
    const msClientSecret = process.env.MICROSOFT_CLIENT_SECRET;
    const msConfigValues = [msTenantId, msClientId, msClientSecret];
    const msConfigSetCount = msConfigValues.filter(Boolean).length;

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

    if (isProduction) {
        const isIsolatedE2EOrigin =
            process.env.BASISHACKS_E2E === "1" &&
            isValidE2ELoopbackOrigin(
                process.env.CURRENT_URL_ORIGIN,
                process.env.NITRO_HOST || process.env.HOST,
                process.env.NITRO_PORT || process.env.PORT,
                process.env.NITRO_UNIX_SOCKET,
            );
        if (!isValidProductionOrigin(process.env.CURRENT_URL_ORIGIN) && !isIsolatedE2EOrigin) {
            console.error(
                "[FATAL] CURRENT_URL_ORIGIN must be the public HTTPS origin without a path, query, or credentials.",
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
    }

    if (msConfigSetCount > 0 && msConfigSetCount < 3) {
        console.warn(
            "[WARNING] Graph configuration is incomplete. " +
                `Configured: ${msConfigSetCount}/3 ` +
                "(MICROSOFT_TENANT_ID, MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET). " +
                "Graph features will be unavailable until all three are configured.",
        );
    }

    const webhookState = process.env.MICROSOFT_WEBHOOK_STATE;
    if (webhookState && new TextEncoder().encode(webhookState).byteLength < 32) {
        const message = "MICROSOFT_WEBHOOK_STATE must be at least 32 bytes when configured.";
        if (isProduction) {
            console.error(`[FATAL] ${message}`);
            process.exit(1);
        } else {
            console.warn(`[WARNING] ${message}`);
        }
    }
});
