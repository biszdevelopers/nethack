import { getCachedSessionUserId } from "~~/server/utils/rateLimit";

const STATIC_PREFIXES = ["/_nuxt/", "/assets/", "/fonts/", "/__nuxt"];
const STATIC_FILE = /\.(?:js|mjs|css|map|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|otf)$/i;

/** One bounded JSON line per dynamic request; static assets are skipped. */
export default defineEventHandler((event) => {
    if (process.env.NODE_ENV === "test") return;

    const pathname = event.path.split("?")[0] || "/";
    const isApi = pathname === "/api" || pathname.startsWith("/api/");
    if (
        !isApi &&
        (STATIC_PREFIXES.some((prefix) => pathname.startsWith(prefix)) ||
            STATIC_FILE.test(pathname))
    ) {
        return;
    }

    const startedAt = Date.now();
    const method = event.method.toUpperCase();
    event.node.res.once("finish", () => {
        const userId = getCachedSessionUserId(event);
        const entry: Record<string, unknown> = {
            event: "http_request",
            method,
            pathname,
            status: event.node.res.statusCode,
            duration_ms: Date.now() - startedAt,
            request_id: (event.context as Record<string, unknown>).requestId,
        };
        if (typeof userId === "number") entry.user_id = userId;
        console.info(JSON.stringify(entry));
    });
});
