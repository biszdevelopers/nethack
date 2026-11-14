import { defineConfig } from "vitest/config";
import baseConfig from "./vitest.config.ts";

export default defineConfig({
    ...baseConfig,
    test: {
        ...baseConfig.test,
        coverage: {
            ...baseConfig.test.coverage,
            include: [
                "app/**/*.{js,ts}",
                "server/**/*.{js,ts}",
                "shared/**/*.{js,ts}",
                "scripts/**/*.{js,mjs,ts}",
                "start-fix.mjs",
                "drizzle.config.ts",
            ],
            reportsDirectory: ".tmp-vitest/full-source-coverage",
            reporter: ["text", "json"],
        },
    },
});
