/** Reject debug utilities in production even when the explicit flag is absent. */
export default defineEventHandler(async (event) => {
    const requestUrl = event.node.req.url || "/";
    let pathname: string;
    try {
        pathname = new URL(requestUrl, "http://localhost").pathname;
    } catch {
        return;
    }

    const normalizedPath = pathname.replace(/\/$/, "") || "/";
    const isDebugRoute =
        normalizedPath === "/api/debug" ||
        normalizedPath.startsWith("/api/debug/") ||
        normalizedPath === "/debug" ||
        normalizedPath.startsWith("/debug/");
    if (!isDebugRoute) return;

    const explicitlyDisabled = /^(1|true|yes|on)$/i.test(process.env.DISABLE_DEBUG_ROUTES ?? "");
    if (process.env.NODE_ENV !== "production" && !explicitlyDisabled) return;

    throw createError({ statusCode: 404, statusMessage: "Not Found" });
});
