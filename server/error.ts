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

function logLine(value: unknown, limit: number): string {
    if (typeof value !== "string") return "";
    return value.replace(/\p{Cc}+/gu, " ").slice(0, limit);
}

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
                      ? status === 401
                          ? "Invalid access token"
                          : original.message || input.message || "The request is invalid"
                      : "The request could not be completed",
                  status,
              );

    if (!isSafe) {
        // Never log the error object: driver errors can embed SQL, parameters,
        // cookies, or credentials. Keep a bounded, structured summary instead.
        console.error(
            JSON.stringify({
                event: "unhandled_request_error",
                status,
                status_message: logLine(original.statusMessage ?? input.statusMessage, 120),
                message: logLine(original.message ?? input.message, 300),
                request_id: (event.context as Record<string, unknown> | undefined)?.requestId,
                route: typeof event.path === "string" ? event.path.split("?")[0] : undefined,
                method: event.method,
            }),
        );
    }
    setResponseStatus(event, apiError.status);
    setResponseHeader(event, "cache-control", "no-store");
    setResponseHeader(event, "vary", "Accept");
    if (apiError.error === "invalid_token" && status === 401) {
        setResponseHeader(event, "www-authenticate", 'Bearer error="invalid_token"');
    }

    if ((getRequestHeader(event, "accept") ?? "").includes("text/html")) {
        setResponseHeader(event, "content-type", "text/html; charset=utf-8");
        // The shared renderer returns a fragment with a hardcoded 500px image.
        // Wrap it in a real document so the page has a language, a title, and a
        // responsive viewport, and constrain the image on narrow screens.
        let fragment: string;
        try {
            fragment = renderErrorPage(apiError.toJSON()).replace(
                "<img width=500 ",
                '<img width="500" alt="Sad mascot" style="max-width:100%;height:auto" ',
            );
        } catch {
            // The renderer base64-encodes its payload with btoa, which throws on
            // non-Latin-1 messages (for example a rubric key or team name). Never
            // let the error page itself leave the request hanging.
            fragment =
                "<h1>The request could not be completed.</h1><p>Return to the previous page and try again.</p>";
        }
        return send(
            event,
            `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>:root{color-scheme:light dark;--bg:#fff;--fg:#0f172a;--muted:#475569;--link:#15803d}@media (prefers-color-scheme:dark){:root{--bg:#0b1120;--fg:#e2e8f0;--muted:#94a3b8;--link:#4ade80}}body{margin:0;padding:2rem 1.25rem;background:var(--bg);color:var(--fg);font-family:ui-sans-serif,system-ui,sans-serif;line-height:1.6}h1{max-width:60ch;font-size:1.15rem;font-weight:600}a{color:var(--link)}p{max-width:60ch;color:var(--muted)}img{display:block;max-width:100%;height:auto;margin:1.5rem 0;border-radius:12px}</style></head><body>${fragment}</body></html>`,
        );
    }

    setResponseHeader(event, "content-type", "application/json; charset=utf-8");
    return send(event, JSON.stringify(apiError.toJSON()));
});
