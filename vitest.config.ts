import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const rootDir = resolve(fileURLToPath(new URL(".", import.meta.url))).replace(/\\/g, "/");

export default defineConfig({
    test: {
        // Only pick up test files matching this pattern
        include: ["tests/**/*.test.ts"],
        // Expose test helpers (describe, it, expect, etc.) globally
        globals: true,
        // Run tests in a Node.js environment
        environment: "node",
        // Setup file that runs before every test suite
        setupFiles: ["tests/setup.ts"],
        coverage: {
            provider: "v8",
            exclude: [
                "nuxt.config.ts",
                "tests/**/helpers.ts",
                "bun-shim/**",
                "drizzle/**",
                "sql/archive/**",
                "documentation/**",
                "**/*.d.ts",
                "**/node_modules/**",
            ],
        },
    },
    resolve: {
        dedupe: ["zod"],
        alias: {
            zod: resolve(rootDir, "node_modules/zod/index.js"),
            "@basis/schema/api": resolve(rootDir, "../basis-schema/src/api.ts"),
            "@basis/schema/auth": resolve(rootDir, "../basis-schema/src/auth.ts"),
            "@basis/schema/client": resolve(rootDir, "../basis-schema/src/client.ts"),
            "@basis/schema/error-page": resolve(rootDir, "../basis-schema/src/error-page.ts"),
            "@basis/schema/permissions": resolve(rootDir, "../basis-schema/src/permissions.ts"),
            // Nuxt-style project root aliases so tests can use ~~/ and ~/
            "~~/": `${rootDir}/`,
            "~~": rootDir,
            "~/": `${rootDir}/`,
            "~": rootDir,
        },
    },
    ssr: {
        // The sibling @basis/schema workspace has its own Zod install. Bundle
        // both packages for tests so Bun/Vitest does not externalize a second
        // copy with incompatible named-export interop.
        noExternal: ["zod", "@basis/schema"],
    },
});
