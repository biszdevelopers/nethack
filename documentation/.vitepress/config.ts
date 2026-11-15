import { defineConfig } from "vitepress";

export default defineConfig({
    title: "basishacks",
    description: "Documentation for the BIBS-C Network Hackathon platform",
    lang: "en-US",
    appearance: "dark",
    cleanUrls: true,
    lastUpdated: true,
    head: [
        ["link", { rel: "icon", type: "image/x-icon", href: "/favicon.ico" }],
        ["link", { rel: "icon", type: "image/png", sizes: "16x16", href: "/favicon-16x16.png" }],
        ["link", { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32x32.png" }],
        ["link", { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" }],
        ["link", { rel: "manifest", href: "/site.webmanifest" }],
        ["meta", { name: "theme-color", content: "#00884a" }],
        ["meta", { name: "msapplication-TileColor", content: "#0a0a0a" }],
        ["meta", { name: "msapplication-TileImage", content: "/android-chrome-192x192.png" }],
    ],
    themeConfig: {
        siteTitle: "basishacks docs",
        nav: [
            { text: "Guide", link: "/guide/getting-started" },
            { text: "Architecture", link: "/architecture/overview" },
            { text: "Frontend", link: "/frontend/components" },
            { text: "Backend", link: "/backend/api-reference" },
            { text: "Shared", link: "/shared/schemas" },
        ],
        sidebar: {
            "/guide/": [
                {
                    text: "Guide",
                    items: [
                        { text: "Getting Started", link: "/guide/getting-started" },
                        { text: "Project Overview", link: "/guide/project-overview" },
                        { text: "Environment Setup", link: "/guide/environment-setup" },
                        { text: "Testing", link: "/guide/testing" },
                        { text: "Documentation Site", link: "/guide/documentation-site" },
                        { text: "Migration from main", link: "/guide/migration-from-main" },
                        { text: "Voting", link: "/guide/voting-and-elections" },
                    ],
                },
            ],
            "/architecture/": [
                {
                    text: "Architecture",
                    items: [
                        { text: "Overview", link: "/architecture/overview" },
                        { text: "Runtime Architecture", link: "/architecture/runtime" },
                        { text: "Database", link: "/architecture/database" },
                        { text: "Authentication & Authorization", link: "/architecture/auth" },
                        { text: "basis-auth Integration", link: "/architecture/oauth2" },
                    ],
                },
            ],
            "/frontend/": [
                {
                    text: "Frontend",
                    items: [
                        { text: "Components", link: "/frontend/components" },
                        { text: "Pages", link: "/frontend/pages" },
                        { text: "Layouts", link: "/frontend/layouts" },
                        { text: "Composables & Utilities", link: "/frontend/composables" },
                    ],
                },
            ],
            "/backend/": [
                {
                    text: "Backend",
                    items: [
                        { text: "API Reference", link: "/backend/api-reference" },
                        { text: "Server Utilities", link: "/backend/server-utilities" },
                        { text: "Plugins & Middleware", link: "/backend/plugins-middleware" },
                        { text: "Debug & AI", link: "/backend/debug-and-ai" },
                    ],
                },
            ],
            "/shared/": [
                {
                    text: "Shared Code",
                    items: [
                        { text: "Zod Schemas", link: "/shared/schemas" },
                        { text: "Type Definitions", link: "/shared/types" },
                        { text: "Rubric System", link: "/shared/rubric" },
                        { text: "Permissions", link: "/shared/permissions" },
                        { text: "Awards", link: "/shared/awards" },
                        { text: "Seasons", link: "/shared/seasons" },
                    ],
                },
            ],
            "/deployment/": [
                {
                    text: "Deployment & Operations",
                    items: [
                        { text: "Security", link: "/deployment/security" },
                        { text: "PostgreSQL & VPS", link: "/deployment/postgresql-migration" },
                        { text: "Rate Limiting", link: "/deployment/rate-limiting" },
                        { text: "Performance", link: "/deployment/performance" },
                    ],
                },
            ],
        },
        search: {
            provider: "local",
        },
        socialLinks: [{ icon: "github", link: "https://github.com" }],
        footer: {
            message: "BIBS-C Network Hackathon Documentation",
            copyright: "Copyright © 2025-2026 BISZ Developers' Club & BINJ Hack Club",
        },
        outline: {
            level: [2, 3],
            label: "On this page",
        },
        editLink: {
            pattern: "https://github.com/basishacks/basishacks-r2/edit/main/documentation/:path",
            text: "Edit this page",
        },
    },
    markdown: {
        lineNumbers: true,
    },
});
