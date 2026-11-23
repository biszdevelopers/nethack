import { getEventState } from "~~/server/utils/event-state";
import { getSeasons } from "~~/server/utils/database/seasons";

const STATIC_ROUTES = [
    { path: "/", changefreq: "weekly", priority: "1.0" },
    { path: "/rules", changefreq: "monthly", priority: "0.7" },
    { path: "/faq", changefreq: "monthly", priority: "0.6" },
    { path: "/contact", changefreq: "yearly", priority: "0.4" },
    { path: "/contributing", changefreq: "yearly", priority: "0.3" },
    { path: "/showcase", changefreq: "monthly", priority: "0.7" },
    { path: "/showcase/beneath-the-surface", changefreq: "yearly", priority: "0.5" },
    { path: "/showcase/signal", changefreq: "yearly", priority: "0.5" },
];

function escapeXml(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&apos;");
}

function absoluteUrl(path: string, origin: string): string {
    try {
        return new URL(path, origin).toString();
    } catch {
        return path;
    }
}

export default defineEventHandler(async (event) => {
    const config = useRuntimeConfig(event);
    const requestUrl = getRequestURL(event);
    const origin = config.public.siteOrigin || requestUrl.origin;

    const [seasons, state] = await Promise.all([getSeasons(event), getEventState(event)]);

    const galleryOpen = state.galleryPublic;
    const resultsPublished = state.resultsVisible;

    const entries = STATIC_ROUTES.map((route) => ({
        loc: absoluteUrl(route.path, origin),
        changefreq: route.changefreq,
        priority: route.priority,
        lastmod: undefined as string | undefined,
    }));

    if (galleryOpen) {
        entries.push({
            loc: absoluteUrl("/projects", origin),
            changefreq: "weekly",
            priority: "0.6",
            lastmod: undefined,
        });
    }

    if (resultsPublished) {
        entries.push({
            loc: absoluteUrl("/results", origin),
            changefreq: "weekly",
            priority: "0.6",
            lastmod: undefined,
        });
    }

    for (const season of seasons) {
        if (season.is_active || season.status === "not_started" || season.status === "paused") {
            continue;
        }

        entries.push({
            loc: absoluteUrl(`/showcase/seasons/${season.id}`, origin),
            changefreq: "yearly",
            priority: "0.5",
            lastmod: season.end_timestamp
                ? new Date(season.end_timestamp).toISOString()
                : undefined,
        });
    }

    const body = entries
        .map(
            (entry) =>
                `<url><loc>${escapeXml(entry.loc)}</loc>` +
                (entry.lastmod ? `<lastmod>${entry.lastmod}</lastmod>` : "") +
                `<changefreq>${entry.changefreq}</changefreq>` +
                `<priority>${entry.priority}</priority></url>`,
        )
        .join("");

    setHeader(event, "content-type", "application/xml; charset=utf-8");
    setHeader(event, "cache-control", "public, max-age=3600");

    return (
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
        body +
        "</urlset>"
    );
});
