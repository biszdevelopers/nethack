export interface PageSeoOptions {
    title: string;
    description?: string;
    path?: string;
    origin?: string;
    type?: "website" | "article";
    image?: string;
    robots?: string;
}

export interface PageSeoHead {
    title: string;
    meta: Array<{ name?: string; property?: string; content: string }>;
    link: Array<{ rel: "canonical"; href: string }>;
}

export function resolveSeoUrl(value: string, origin?: string): string {
    if (/^https?:\/\//i.test(value) || !origin) return value;

    try {
        return new URL(value, origin).toString();
    } catch {
        return value;
    }
}

export function buildPageSeo(options: PageSeoOptions, origin?: string): PageSeoHead {
    const path = options.path ?? "/";
    const url = resolveSeoUrl(path, origin);
    const image = options.image ? resolveSeoUrl(options.image, origin) : undefined;
    const description = options.description?.trim();

    const meta: PageSeoHead["meta"] = [
        { property: "og:title", content: options.title },
        { property: "og:url", content: url },
        { property: "og:type", content: options.type ?? "website" },
        { name: "twitter:card", content: image ? "summary_large_image" : "summary" },
        { name: "twitter:title", content: options.title },
    ];

    if (description) {
        meta.push(
            { name: "description", content: description },
            { property: "og:description", content: description },
            { name: "twitter:description", content: description },
        );
    }

    if (image) {
        meta.push(
            { property: "og:image", content: image },
            { name: "twitter:image", content: image },
        );
    }

    if (options.robots) {
        meta.push({ name: "robots", content: options.robots });
    }

    return {
        title: options.title,
        meta,
        link: [{ rel: "canonical", href: url }],
    };
}

/** Resolves the public origin so canonical and social URLs stay absolute. */
export function pageSeo(options: PageSeoOptions): Parameters<typeof useHead>[0] {
    const config = useRuntimeConfig();
    const requestUrl = useRequestURL();
    const origin = options.origin ?? (config.public.siteOrigin || requestUrl.origin);

    return buildPageSeo(options, origin) as unknown as Parameters<typeof useHead>[0];
}
