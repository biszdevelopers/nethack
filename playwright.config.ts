import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3005";

export default defineConfig({
    testDir: "./e2e/browser",
    fullyParallel: false,
    workers: 1,
    timeout: 60_000,
    expect: { timeout: 10_000 },
    reporter: [["list"], ["html", { outputFolder: ".tmp-playwright-report", open: "never" }]],
    outputDir: ".tmp-playwright-results",
    use: {
        ...devices["Desktop Chrome"],
        baseURL,
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
    },
    webServer: {
        command: "node e2e/start-server.mjs",
        url: `${baseURL}/api/seasons`,
        timeout: 180_000,
        reuseExistingServer: false,
        env: {
            ...process.env,
            NODE_ENV: "test",
            BASISHACKS_E2E: "1",
            PLAYWRIGHT_BASE_URL: baseURL,
            DATABASE_URL: process.env.DATABASE_URL || "",
            BASIS_AUTH_COOKIE_SECRET: "browser-e2e-cookie-secret-at-least-32-bytes",
            TRUSTED_PROXY_HOPS: "0",
            DISABLE_DEBUG_ROUTES: "1",
        },
    },
});
