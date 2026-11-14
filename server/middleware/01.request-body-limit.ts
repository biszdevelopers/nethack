import { readLimitedRequestBody } from "~~/server/utils/limited-json-body";

const API_REQUEST_BODY_MAX_BYTES = 1024 * 1024;
const STREAMED_BODY_PATHS = new Set(["/api/_webhooks/lifecycle", "/api/_webhooks/update"]);
const BODY_METHODS = new Set(["DELETE", "PATCH", "POST", "PUT"]);

/** Bound API request buffering before route handlers and schema validation run. */
export default defineEventHandler(async (event) => {
    if (!event.path.startsWith("/api/")) return;
    const method = event.method.toUpperCase();
    if (!BODY_METHODS.has(method)) return;
    if (STREAMED_BODY_PATHS.has(event.path)) return;
    // Large profile images are bounded after the route authenticates the caller.
    if (method === "PATCH" && /^\/api\/users\/[^/]+$/.test(event.path)) return;

    event._requestBody = (await readLimitedRequestBody(
        event,
        API_REQUEST_BODY_MAX_BYTES,
    )) as unknown as BodyInit;
});
