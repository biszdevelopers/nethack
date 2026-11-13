import { defineConfig } from "vitest/config";
import baseConfig from "./vitest.config.ts";

export default defineConfig({
    ...baseConfig,
    define: {
        ...baseConfig.define,
        "import.meta.server": "true",
    },
    test: {
        ...baseConfig.test,
        include: ["tests/app/use-basis-auth-session-runtime.test.ts"],
        maxWorkers: 1,
        testTimeout: 15_000,
        coverage: {
            ...baseConfig.test.coverage,
            include: ["app/composables/useBasisAuthSession.ts"],
            reportsDirectory: ".tmp-vitest/server-mode-coverage",
            reporter: ["json"],
        },
    },
});
