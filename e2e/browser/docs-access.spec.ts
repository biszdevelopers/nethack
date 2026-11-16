import { expect, test, type Page } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL;
if (!baseURL) throw new Error("Set PLAYWRIGHT_BASE_URL in .env for the browser tests.");

async function loginAs(page: Page, email: string, redirectPath: string) {
    await page.goto(`/api/login?redirect=${encodeURIComponent(redirectPath)}`);
    await expect(page.getByRole("heading", { name: "Choose a test identity" })).toBeVisible();
    const consentResponse = page.waitForResponse(
        (response) =>
            new URL(response.url()).pathname === "/authorize/consent" &&
            response.request().method() === "POST",
    );
    await page.getByRole("button").filter({ hasText: email }).click();
    expect((await consentResponse).status()).toBe(302);
    await expect(page).toHaveURL((url) => url.pathname === redirectPath);
}

test("docs pages and assets require judge or administrator permission", async ({ browser }) => {
    const anonymousContext = await browser.newContext({ baseURL });
    const anonymous = await anonymousContext.newPage();
    const anonPageResponse = await anonymous.goto("/docs/");
    expect(anonPageResponse?.status()).toBeGreaterThanOrEqual(400);
    const anonymousAsset = await anonymousContext.request.get("/docs/assets/nonexistent.js");
    expect(anonymousAsset.status()).toBeGreaterThanOrEqual(400);
    await anonymousContext.close();

    const participantContext = await browser.newContext({ baseURL });
    const participant = await participantContext.newPage();
    await loginAs(participant, "participant@e2e.basishacks.invalid", "/dashboard");
    await expect(participant).toHaveURL((url) => url.pathname === "/dashboard");
    const participantPage = await participantContext.request.get("/docs/guide/getting-started");
    const participantAsset = await participantContext.request.get("/docs/site.webmanifest");
    expect(participantPage.status()).toBe(403);
    expect(participantAsset.status()).toBe(403);
    await participant.goto("/dashboard");
    await expect(participant.getByRole("link", { name: "Documentation" })).toHaveCount(0);
    await participantContext.close();

    const judgeContext = await browser.newContext({ baseURL });
    const judge = await judgeContext.newPage();
    const browserErrors: string[] = [];
    judge.on("console", (message) => {
        if (message.type() === "error") browserErrors.push(`Console: ${message.text()}`);
    });
    judge.on("pageerror", (error) => browserErrors.push(`Page: ${error.message}`));
    judge.on("requestfailed", (request) => {
        browserErrors.push(
            `Request: ${request.url()} — ${request.failure()?.errorText ?? "failed"}`,
        );
    });
    judge.on("response", (response) => {
        if (new URL(response.url()).pathname.startsWith("/docs/")) {
            browserErrors.push(
                `HTTP ${response.status()} [${response.headers()["content-type"] ?? "unknown"}]: ${response.url()}`,
            );
        }
    });
    await loginAs(judge, "judge@e2e.basishacks.invalid", "/docs/");
    await expect(
        judge.getByRole("heading", { name: "Network Hackathon Platform Docs" }),
        browserErrors.join("\n"),
    ).toBeVisible();
    await judge.goto("/docs/guide/getting-started");
    await expect(judge.getByRole("heading", { name: "Getting Started" })).toBeVisible();
    const scriptPath = await judge
        .locator('script[src^="/docs/assets/"]')
        .first()
        .getAttribute("src");
    expect(scriptPath).toBeTruthy();
    if (!scriptPath)
        throw new Error("VitePress HTML did not include a protected JavaScript asset.");
    expect((await judgeContext.request.get(scriptPath)).status()).toBe(200);
    await judgeContext.close();

    const adminContext = await browser.newContext({ baseURL });
    const admin = await adminContext.newPage();
    await loginAs(admin, "admin@e2e.basishacks.invalid", "/developers");
    await admin.goto("/developers");
    const documentationLink = admin.getByRole("link", { name: "Documentation", exact: true });
    await expect(documentationLink).toBeVisible();
    await documentationLink.click();
    await expect(admin).toHaveURL((url) => url.pathname === "/developers/docs");
    await expect(
        admin.getByRole("link", { name: /Open in new tab|Open documentation in a new tab/ }),
    ).toBeVisible();
    const docsFrame = admin.frameLocator('iframe[title="nethack documentation"]');
    await expect(
        docsFrame.getByRole("heading", { name: "Network Hackathon Platform Docs" }),
    ).toBeVisible();
    const portalLink = docsFrame.getByRole("link", { name: /Portal/ });
    await expect(portalLink).toBeVisible();
    await portalLink.click();
    await expect(admin).toHaveURL((url) => url.pathname === "/developers");
    await adminContext.close();
});
