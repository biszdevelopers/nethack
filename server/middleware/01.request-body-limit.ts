import { readLimitedRequestBody } from "~~/server/utils/limited-json-body";

const API_REQUEST_BODY_MAX_BYTES = 1024 * 1024;
const STREAMED_BODY_PATHS = new Set(["/api/_webhooks/lifecycle", "/api/_webhooks/update"]);
const BODY_METHODS = new Set(["DELETE", "PATCH", "POST", "PUT"]);

/** Reject an advertised oversized body before any bytes are buffered. */
function rejectDeclaredOversize(event: Parameters<typeof readLimitedRequestBody>[0]) {
    const header = event.node.req.headers["content-length"];
    if (typeof header !== "string") return;
    const declared = Number(header);
    if (!Number.isSafeInteger(declared) || declared < 0 || declared <= API_REQUEST_BODY_MAX_BYTES) {
        return;
    }
    event.node.req.pause();
    if (event.node.res && !event.node.res.headersSent) {
        event.node.res.setHeader("Connection", "close");
    }
    throw createError({ statusCode: 413, statusMessage: "Payload Too Large" });
}

/** Bound API request buffering before route handlers and schema validation run. */
export default defineEventHandler(async (event) => {
    // `event.path` includes the query string, but route matching does not.
    // Match on the pathname so a query string cannot bypass these exemptions.
    const pathname = event.path.split("?")[0]!;
    if (!pathname.startsWith("/api/")) return;
    const method = event.method.toUpperCase();
    if (!BODY_METHODS.has(method)) return;
    if (STREAMED_BODY_PATHS.has(pathname)) return;
    // Large profile images are bounded after the route authenticates the caller.
    if (method === "PATCH" && /^\/api\/users\/[^/]+$/.test(pathname)) return;

    rejectDeclaredOversize(event);

    event._requestBody = (await readLimitedRequestBody(
        event,
        API_REQUEST_BODY_MAX_BYTES,
    )) as unknown as BodyInit;
});
