import { randomBytes } from "node:crypto";
import type { H3Event } from "h3";
import { setHeader } from "h3";

/**
 * Applies the baseline HTTP security headers to an event. Shared because a
 * middleware that rejects a request early must not drop them from the error.
 */
export function applySecurityHeaders(event: H3Event): void {
    const nonce = randomBytes(18).toString("base64");
    if (event.context) event.context.cspNonce = nonce;

    // API responses may contain caller-specific data. Prevent browsers and
    // shared intermediaries from retaining any API response, including errors.
    const pathname = (event.path ?? "").split("?")[0] || "";
    if (pathname === "/api" || pathname.startsWith("/api/")) {
        setHeader(event, "Cache-Control", "private, no-store");
    }

    // Enforce HTTPS for two years, include subdomains, and declare preload
    // eligibility for the HSTS preload list.
    setHeader(event, "Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");

    // Only the protected documentation is allowed to be framed, so the admin
    // portal can embed it without weakening the app's frame protections.
    const isDocs = pathname === "/docs" || pathname.startsWith("/docs/");

    // Prevent the site from being embedded in frames / iframes (clickjacking).
    setHeader(event, "X-Frame-Options", isDocs ? "SAMEORIGIN" : "DENY");

    // Isolate the browsing context from cross-origin openers and only allow
    // same-origin subresources; the docs iframe is same-origin.
    setHeader(event, "Cross-Origin-Opener-Policy", "same-origin");
    setHeader(event, "Cross-Origin-Resource-Policy", "same-origin");

    // Stop browsers from MIME-sniffing responses away from the declared type.
    setHeader(event, "X-Content-Type-Options", "nosniff");

    // Send only the origin as referrer for cross-origin requests, and the full
    // URL for same-origin requests.
    setHeader(event, "Referrer-Policy", "strict-origin-when-cross-origin");

    // Disable powerful browser features that the hackathon app does not use.
    setHeader(
        event,
        "Permissions-Policy",
        "camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=(), autoplay=(), encrypted-media=(), picture-in-picture=()",
    );

    // Content Security Policy
    //
    // default-src 'self'            Fallback for any unspecified fetch directive.
    // script-src 'self' 'nonce-…'   Self-hosted JS and per-response nonce-bound Nuxt
    //                               hydration scripts. 'unsafe-inline' and
    //                               'unsafe-eval' are omitted.
    // style-src 'self' 'unsafe-inline'
    //                               Self-hosted CSS plus inline styles used by Vue/
    //                               Nuxt UI components (e.g. :style bindings).
    // font-src 'self'               Fonts are self-hosted via @nuxt/fonts local provider.
    // img-src 'self' blob: data:    Self-hosted images, image previews, and data URIs.
    // connect-src 'self'           API calls to the same origin.
    // object-src 'none'             No Flash / plugin objects.
    // base-uri 'self'               Prevent injected <base> tags from rewriting origins.
    // form-action 'self'            Restrict form submissions to same origin.
    // frame-ancestors 'none'        Reinforces X-Frame-Options DENY via CSP.
    setHeader(
        event,
        "Content-Security-Policy",
        `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors ${isDocs ? "'self'" : "'none'"}`,
    );
}
