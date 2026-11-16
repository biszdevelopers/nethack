import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL;
if (!baseURL) throw new Error("Set PLAYWRIGHT_BASE_URL in .env for the browser tests.");

const widths = [320, 1440] as const;
const accessibilityTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const PUBLIC_ROUTES = [
    "/",
    "/rules",
    "/contributing",
    "/showcase",
    "/showcase/signal",
    "/showcase/beneath-the-surface",
    "/showcase/seasons/1",
    "/seasons/1",
] as const;

const PARTICIPANT_ROUTES = [
    "/dashboard",
    "/dashboard/general",
    "/dashboard/presentation",
    "/dashboard/results",
    "/dashboard/teams",
    "/profile",
    "/user",
    "/voting",
] as const;

const JUDGE_ROUTES = ["/judging", "/judging/history/1"] as const;

const ADMIN_ROUTES = [
    "/developers",
    "/developers/season",
    "/developers/teams",
    "/developers/users",
    "/developers/docs",
] as const;

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

async function sweep(page: Page, routes: readonly string[]) {
    const pageErrors: string[] = [];
    const serverErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("response", (response) => {
        if (response.status() >= 500) {
            serverErrors.push(`${response.status()} ${new URL(response.url()).pathname}`);
        }
    });

    for (const route of routes) {
        for (const width of widths) {
            pageErrors.length = 0;
            serverErrors.length = 0;
            await page.setViewportSize({ width, height: 900 });

            const response = await page.goto(route, { waitUntil: "load" });
            const status = response?.status() ?? 0;
            // The archive route intentionally 404s while the season it names is
            // still active; it only opens for finished, inactive seasons.
            const archiveMayBeMissing = route === "/showcase/seasons/1";
            expect(
                status < 400 || (archiveMayBeMissing && status === 404),
                `${route} returned HTTP ${status}`,
            ).toBe(true);

            if (route === "/developers/docs") {
                await expect(
                    page.locator('iframe[title="nethack documentation"]'),
                    `${route} at ${width}px should embed the docs`,
                ).toBeVisible({ timeout: 20_000 });
            } else {
                await expect(
                    page.getByRole("heading").first(),
                    `${route} at ${width}px should render a heading`,
                ).toBeVisible({ timeout: 20_000 });
            }

            await expect
                .poll(
                    () =>
                        page.evaluate(
                            () =>
                                document.documentElement.scrollWidth -
                                document.documentElement.clientWidth,
                        ),
                    { timeout: 10_000, message: `${route} overflows at ${width}px` },
                )
                .toBeLessThanOrEqual(0);

            if (width === 320) {
                const accessibility = await new AxeBuilder({ page })
                    .withTags(accessibilityTags)
                    .analyze();
                expect(
                    accessibility.violations,
                    `${route} at ${width}px: ${JSON.stringify(accessibility.violations, null, 2)}`,
                ).toEqual([]);
            }

            expect(pageErrors, `${route} at ${width}px threw in the browser`).toEqual([]);
            expect(serverErrors, `${route} at ${width}px returned a server error`).toEqual([]);
        }
    }
}

test("public routes render without errors at every width", async ({ page }) => {
    test.setTimeout(180_000);
    await sweep(page, PUBLIC_ROUTES);
});

test("participant routes render without errors at every width", async ({ page }) => {
    test.setTimeout(240_000);
    await loginAs(page, "participant@e2e.basishacks.invalid", "/dashboard");
    await sweep(page, PARTICIPANT_ROUTES);
});

test("judge routes render without errors at every width", async ({ page }) => {
    test.setTimeout(180_000);
    await loginAs(page, "judge@e2e.basishacks.invalid", "/judging");
    await sweep(page, JUDGE_ROUTES);
});

test("administrator routes render without errors at every width", async ({ page }) => {
    test.setTimeout(240_000);
    await loginAs(page, "admin@e2e.basishacks.invalid", "/developers");
    await sweep(page, ADMIN_ROUTES);
});

test("anonymous visitors are redirected away from protected pages", async ({ page }) => {
    for (const route of ["/dashboard", "/dashboard/teams", "/developers", "/judging"] as const) {
        await page.goto(route);
        await expect(page, `${route} should not render for an anonymous visitor`).not.toHaveURL(
            (url) => url.pathname === route,
        );
        await expect(page.getByRole("heading", { name: "Choose a test identity" })).toBeVisible();
    }
});
