import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { IconifyJSON } from "@iconify/types";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const basisSchemaRoot = resolve(projectRoot, "../basis-schema/src");
const iconManifest = JSON.parse(
    readFileSync(resolve(projectRoot, "shared/icon-bundle-manifest.json"), "utf8"),
);
const iconServerBundlePath = resolve(
    projectRoot,
    "node_modules/.cache/basishacks-icon-server-bundle.json",
);
let iconServerCollections: IconifyJSON[];
try {
    iconServerCollections = JSON.parse(readFileSync(iconServerBundlePath, "utf8"));
} catch (error) {
    throw new Error(
        "The generated server icon bundle is missing. Run `bun run postinstall` or `bun run build` to regenerate it.",
        { cause: error },
    );
}
// Nitro interpolates custom handler paths into a virtual ES module. Windows
// backslashes must be normalized so username segments such as `\34648` are not
// parsed as legacy octal escapes by Rollup.
const nitroErrorHandler = resolve(projectRoot, "server/error.ts").replaceAll("\\", "/");

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
    alias: {
        "@basis/schema/api": resolve(basisSchemaRoot, "api.ts"),
        "@basis/schema/auth": resolve(basisSchemaRoot, "auth.ts"),
        "@basis/schema/client": resolve(basisSchemaRoot, "client.ts"),
        "@basis/schema/error-page": resolve(basisSchemaRoot, "error-page.ts"),
        "@basis/schema/permissions": resolve(basisSchemaRoot, "permissions.ts"),
    },
    compatibilityDate: "2025-07-15",
    runtimeConfig: {
        public: {
            siteOrigin: "",
        },
    },
    devtools: { enabled: false }, // keeps crasing
    modules: ["@nuxt/eslint", "@nuxt/ui", "@comark/vue"],

    css: ["~/assets/css/main.css"],
    colorMode: {
        preference: "system",
        fallback: "dark",
    },
    experimental: {
        asyncContext: true,
    },
    devServer: {
        port: 24598,
    },
    icon: {
        serverBundle: {
            collections: iconServerCollections,
        },
        clientBundle: {
            icons: iconManifest.icons,
            scan: iconManifest.scan,
        },
    },
    fonts: {
        provider: "local",
        defaults: {
            preload: true,
        },
        processCSSVariables: true,
        families: [
            { name: "Unbounded", src: "/fonts/unbounded-800.woff2", weight: 800 },
            { name: "Orbitron", src: "/fonts/orbitron-700.woff2", weight: 700 },
            { name: "Silkscreen", src: "/fonts/silkscreen-700.woff2", weight: 700 },
            { name: "Creepster", src: "/fonts/creepster-400.woff2", weight: 400 },
            { name: "Space Mono", src: "/fonts/space-mono-700.woff2", weight: 700 },
            {
                name: "Cormorant Garamond",
                src: "/fonts/cormorant-garamond-600.woff2",
                weight: 600,
            },
            { name: "Chakra Petch", src: "/fonts/chakra-petch-700.woff2", weight: 700 },
        ],
    },
    routeRules: {
        "/api/login": {
            headers: { "Cache-Control": "private, no-store" },
        },
        "/api/auth/**": {
            headers: { "Cache-Control": "private, no-store" },
        },
        "/_nuxt/**": {
            headers: { "Cache-Control": "public, max-age=31536000, immutable" },
        },
        "/assets/**": {
            headers: { "Cache-Control": "public, max-age=31536000, immutable" },
        },
        "/fonts/**": {
            headers: { "Cache-Control": "public, max-age=31536000, immutable" },
        },
        "/docs/**": {
            headers: { "Cache-Control": "private, no-store" },
        },
    },
    vite: {
        server: {
            allowedHosts: true,
        },
        optimizeDeps: {
            include: ["@comark/vue"],
        },
        build: {
            // Kept at es2020: the project currently builds reliably with this
            // target, and both Node.js >= v24 and Bun support it without issue.
            target: "es2020",
            minify: "esbuild",
            sourcemap: true,
            rollupOptions: {
                onwarn(warning, warn) {
                    if (warning.message.includes("Sourcemap is likely to be incorrect")) return;
                    if (warning.code === "TOLERATED_TRANSFORM") return;
                    if (warning.code === "PLUGIN_TIMINGS") return;
                    if (warning.code === "CIRCULAR_DEPENDENCY") return;
                    if (warning.message.includes("/* #__PURE__ */")) return;
                    warn(warning);
                },
            },
        },
    },
    nitro: {
        errorHandler: nitroErrorHandler,
        // Use the portable Node server output for both Node.js and Bun production starts.
        preset: process.env.NITRO_PRESET ?? "node-server",
        compressPublicAssets: true,
        externals: {
            // Node's production export condition needs Vue's production CJS
            // files, which Nitro's tracer currently omits in dev bundles.
            trace: false,
        },
        rollupConfig: {
            // Raised from 1 after an A/B build: 1m49s total vs 2m20s-2m36s,
            // with no file-operation failures. Revert if the VPS sees FD pressure.
            maxParallelFileOps: 4,
            onwarn(warning, warn) {
                if (warning.code === "UNRESOLVED_IMPORT") return;
                if (warning.code === "CIRCULAR_DEPENDENCY") return;
                if (warning.code === "PLUGIN_TIMINGS") return;
                if (warning.message.includes("/* #__PURE__ */")) return;
                warn(warning);
            },
        },
    },
});
