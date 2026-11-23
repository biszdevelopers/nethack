import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

const viewports = [320, 375, 768, 1024, 1440] as const;

async function loginAsAdmin(page: Page) {
    await page.goto(`/api/login?redirect=${encodeURIComponent("/developers/season")}`);
    await expect(page.getByRole("heading", { name: "Choose a test identity" })).toBeVisible();
    const consentResponse = page.waitForResponse(
        (response) =>
            new URL(response.url()).pathname === "/authorize/consent" &&
            response.request().method() === "POST",
    );
    await page.getByRole("button").filter({ hasText: "admin@e2e.basishacks.invalid" }).click();
    const consent = await consentResponse;
    const consentBody = consent.status() === 302 ? "" : await consent.text();
    expect(
        consent.status(),
        `OIDC test provider consent failed with HTTP ${consent.status()}: ${consentBody}`,
    ).toBe(302);
    await expect(page).toHaveURL((url: URL) => url.pathname === "/developers/season");
}

async function expectTouchTarget(target: Locator) {
    const box = await target.boundingBox();
    expect(box).not.toBeNull();
    if (!box) throw new Error("The expected touch target is not visible.");
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
}

async function openSeasonTab(page: Page, name: string) {
    const tab = page.getByRole("tab", { name, exact: true });
    await expect(tab).toBeVisible();
    if ((await tab.getAttribute("aria-selected")) !== "true") await tab.click();
}

async function setSeasonStatus(page: Page, status: string) {
    const statusValues: Record<string, string> = {
        "Not Started": "not_started",
        "In Progress": "in_progress",
        Voting: "voting",
        Finished: "finished",
        Paused: "paused",
    };
    const result = await page.evaluate(async (nextStatus) => {
        const response = await fetch("/api/admin/hackathon", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ season_id: 1, status: nextStatus }),
        });
        return { status: response.status, body: await response.text() };
    }, statusValues[status] ?? status);
    expect(result.status, `season status failed: ${result.body}`).toBe(200);
}

async function expectUnreleasedThemeRedacted(
    page: Page,
    request: APIRequestContext,
    expectedStatus: "not_started" | "paused",
    secretName: string,
    secretDescription: string,
) {
    const response = await request.get("/api/seasons");
    expect(response.ok()).toBeTruthy();

    const { data: seasons } = (await response.json()) as {
        data: Array<{
            id: number;
            status: string;
            theme_name: string | null;
            theme_description: string | null;
        }>;
    };
    const season = seasons.find((item) => item.id === 1);
    expect(season).toMatchObject({
        status: expectedStatus,
        theme_name: null,
        theme_description: null,
    });

    await page.goto("/seasons/1");
    await expect(
        page.getByText("The theme will be announced when the season begins."),
    ).toBeVisible();
    await expect(page.getByText(secretName, { exact: false })).toHaveCount(0);
    await expect(page.getByText(secretDescription, { exact: false })).toHaveCount(0);
}

for (const width of viewports) {
    test(`public season detail is usable and accessible at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto("/seasons/1");

        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        const dimensions = await page.evaluate(() => ({
            clientWidth: document.documentElement.clientWidth,
            scrollWidth: document.documentElement.scrollWidth,
            bodyScrollWidth: document.body.scrollWidth,
        }));
        expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
        expect(dimensions.bodyScrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);

        const backLink = page.getByRole("link", { name: "Back to overview" });
        await expect(backLink).toBeVisible();
        const target = await backLink.boundingBox();
        expect(target).not.toBeNull();
        if (!target) throw new Error("The visible overview link has no bounding box.");
        expect(target.height).toBeGreaterThanOrEqual(44);
        expect(target.width).toBeGreaterThanOrEqual(44);

        const accessibility = await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
            .analyze();
        expect(accessibility.violations).toEqual([]);

        await backLink.focus();
        await page.keyboard.press("Enter");
        await expect(page).toHaveURL((url) => url.pathname === "/");
    });
}

test("public season JSON and page redact a configured unreleased theme", async ({
    page,
    request,
}) => {
    const secretName = "E2E hidden theme do not expose 7c94b1";
    const secretDescription = "E2E private theme details do not expose a31f20";

    await loginAsAdmin(page);
    await openSeasonTab(page, "Season settings");
    const configuration = page
        .getByRole("heading", { name: "Season settings" })
        .locator("xpath=ancestor::section[1]");
    for (const label of [
        "Maximum projects per voter",
        "Event starts",
        "Event ends",
        "Voting starts",
        "Voting ends",
        "Results released",
        "Theme name",
        "Theme description",
    ]) {
        await expectTouchTarget(configuration.getByLabel(label, { exact: true }));
    }
    await setSeasonStatus(page, "Not Started");

    const nameInput = configuration.getByLabel("Theme name", { exact: true });
    await expectTouchTarget(nameInput);
    const descriptionInput = configuration.getByLabel("Theme description", { exact: true });
    await expectTouchTarget(descriptionInput);
    await nameInput.fill(secretName);
    await descriptionInput.fill(secretDescription);

    const saveSettings = page.waitForResponse(
        (candidate) =>
            candidate.url().endsWith("/api/admin/hackathon") &&
            candidate.request().method() === "PATCH",
    );
    await page.getByRole("button", { name: "Save changes" }).click();
    expect((await saveSettings).ok()).toBeTruthy();

    const configured = await page.evaluate(async () => {
        const response = await fetch("/api/admin/hackathon");
        if (!response.ok)
            throw new Error(`Could not verify admin season configuration: ${response.status}`);
        return (await response.json()) as {
            data: { seasons: { id: number; theme_name: string; theme_description: string }[] };
        };
    });
    expect(configured.data.seasons.find((item) => item.id === 1)).toMatchObject({
        theme_name: secretName,
        theme_description: secretDescription,
    });

    await page.setViewportSize({ width: 320, height: 900 });
    await expectUnreleasedThemeRedacted(
        page,
        request,
        "not_started",
        secretName,
        secretDescription,
    );

    await page.goto("/developers/season");
    await openSeasonTab(page, "Season settings");
    await expect(page.getByRole("heading", { name: "Season settings" })).toBeVisible();
    await setSeasonStatus(page, "Paused");
    await expectUnreleasedThemeRedacted(page, request, "paused", secretName, secretDescription);
});
