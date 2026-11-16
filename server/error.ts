import { APIError } from "@basis/schema/api";
import { renderErrorPage } from "@basis/schema/error-page";
import { getRequestHeader, send, setResponseHeader, setResponseStatus } from "h3";

const errorNameForStatus = (status: number, statusMessage?: string) => {
    if (statusMessage === "invalid_token" || statusMessage === "insufficient_permission") {
        return statusMessage;
    }
    if (status === 400) return "invalid_request";
    if (status === 401) return "invalid_token";
    if (status === 403) return "forbidden";
    if (status === 404) return "not_found";
    if (status === 409) return "conflict";
    if (status === 429) return "rate_limited";
    return "server_error";
};

export default defineNitroErrorHandler((input, event) => {
    const original = (input.cause ?? input) as any;
    const status = original.status ?? original.statusCode ?? input.statusCode ?? 500;
    const isSafe = status < 500;
    const apiError =
        original instanceof APIError
            ? original
            : new APIError(
                  errorNameForStatus(status, original.statusMessage ?? input.statusMessage),
                  isSafe
                      ? original.message || input.message || "The request is invalid"
                      : "The request could not be completed",
                  status,
              );

    if (!isSafe) console.error("Unhandled API error", input);
    setResponseStatus(event, apiError.status);
    setResponseHeader(event, "cache-control", "no-store");
    setResponseHeader(event, "vary", "Accept");
    if (apiError.error === "invalid_token") {
        setResponseHeader(event, "www-authenticate", 'Bearer error="invalid_token"');
    }

    if ((getRequestHeader(event, "accept") ?? "").includes("text/html")) {
        setResponseHeader(event, "content-type", "text/html; charset=utf-8");
        // The shared renderer returns a fragment with a hardcoded 500px image.
        // Wrap it in a real document so the page has a language, a title, and a
        // responsive viewport, and constrain the image on narrow screens.
        const fragment = renderErrorPage(apiError.toJSON()).replace(
            "<img width=500 ",
            '<img width="500" alt="Sad mascot" style="max-width:100%;height:auto" ',
        );
        return send(
            event,
            `<!DOCTYPE html><html lang="en" class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>:root{color-scheme:dark}body{margin:0;padding:2rem 1.25rem;background:#0b1120;color:#e2e8f0;font-family:ui-sans-serif,system-ui,sans-serif;line-height:1.6}h1{max-width:60ch;font-size:1.15rem;font-weight:600}a{color:#4ade80}p{max-width:60ch;color:#94a3b8}img{display:block;max-width:100%;height:auto;margin:1.5rem 0;border-radius:12px}</style></head><body>${fragment}</body></html>`,
        );
    }

    setResponseHeader(event, "content-type", "application/json; charset=utf-8");
    return send(event, JSON.stringify(apiError.toJSON()));
});
