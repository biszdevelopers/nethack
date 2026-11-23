/** Liveness: the process is up and can answer. No dependency checks, no auth. */
export default defineEventHandler((event) => {
    setHeader(event, "Cache-Control", "no-store");
    if (/^(1|true|yes|on)$/i.test(process.env.HEALTH_DETAILS ?? "")) {
        return { status: "ok", uptime_s: Math.round(process.uptime()) };
    }
    return { status: "ok" };
});
