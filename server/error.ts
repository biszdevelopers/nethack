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
        return send(event, renderErrorPage(apiError.toJSON()));
    }

    setResponseHeader(event, "content-type", "application/json; charset=utf-8");
    return send(event, JSON.stringify(apiError.toJSON()));
});
