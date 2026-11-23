const SECURITY_CONTACT = "mailto:security@biszd.dev";

/** RFC 9116 security contact file; served statically and cached briefly. */
export default defineEventHandler((event) => {
    const origin = (() => {
        try {
            return new URL(process.env.CURRENT_URL_ORIGIN ?? "").origin;
        } catch {
            return "";
        }
    })();

    setHeader(event, "Cache-Control", "public, max-age=86400");
    setHeader(event, "Content-Type", "text/plain; charset=utf-8");
    return [
        `Contact: ${SECURITY_CONTACT}`,
        "Expires: 2027-12-31T00:00:00.000Z",
        "Preferred-Languages: en",
        ...(origin ? [`Canonical: ${origin}/.well-known/security.txt`] : []),
        "",
    ].join("\n");
});
