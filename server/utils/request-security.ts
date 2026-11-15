import type { H3Event } from "h3";
import type { TLSSocket } from "node:tls";

function sameOrigin(value: string | undefined, expectedOrigin: string): boolean {
    if (!value) return false;
    try {
        return new URL(value).origin === expectedOrigin;
    } catch {
        return false;
    }
}

/** Require browser cookie-authenticated mutations to originate from this site. */
export function enforceSameOriginCookieRequest(event: H3Event): void {
    if (getHeader(event, "authorization")) return;

    const configuredOrigin = process.env.CURRENT_URL_ORIGIN;
    const host = getHeader(event, "host");
    const forwardedProtocol = getHeader(event, "x-forwarded-proto")?.split(",")[0]?.trim();
    const tlsSocket = event.node.req.socket as TLSSocket | undefined;
    const protocol = forwardedProtocol || (tlsSocket?.encrypted ? "https" : "http");
    let expectedOrigin: string;
    try {
        expectedOrigin = configuredOrigin
            ? new URL(configuredOrigin).origin
            : host
              ? new URL(`${protocol}://${host}`).origin
              : "";
    } catch {
        expectedOrigin = "";
    }

    const origin = getHeader(event, "origin");
    const referer = getHeader(event, "referer");
    const fetchSite = getHeader(event, "sec-fetch-site");
    const sourceMatches = origin
        ? sameOrigin(origin, expectedOrigin)
        : sameOrigin(referer, expectedOrigin);
    if (!expectedOrigin || !sourceMatches || fetchSite?.toLowerCase() === "cross-site") {
        throw createError({
            statusCode: 403,
            statusMessage: "Cross-site request rejected",
            message: "This request must come from the same site",
        });
    }
}
