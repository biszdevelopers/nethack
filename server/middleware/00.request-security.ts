import { enforceSameOriginCookieRequest } from "~~/server/utils/request-security";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const SERVER_TO_SERVER_POST_PATHS = new Set(["/api/_webhooks/update", "/api/_webhooks/lifecycle"]);

/** Protect every cookie-authenticated mutation from cross-site request forgery. */
export default defineEventHandler((event) => {
    const method = event.method.toUpperCase();
    if (SAFE_METHODS.has(method)) return;
    if (method === "POST" && SERVER_TO_SERVER_POST_PATHS.has(event.path)) return;
    enforceSameOriginCookieRequest(event);
});
