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

async function setSeasonStatus(page: Page, selector: Locator, status: string) {
    if ((await selector.innerText()).includes(status)) return;
    const saved = page.waitForResponse(
        (candidate) =>
            candidate.url().endsWith("/api/admin/hackathon") &&
            candidate.request().method() === "PATCH",
    );
    await selector.click();
    await page.getByRole("option", { name: status, exact: true }).click();
    expect((await saved).ok()).toBeTruthy();
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
    const configuration = page
        .getByRole("heading", { name: "Hackathon Configuration" })
        .locator("xpath=ancestor::section[1]");
    const status = configuration.getByRole("combobox").first();
    await expectTouchTarget(status);
    for (const label of [
        "Max Votes Per User",
        "Schedule Start",
        "Schedule End",
        "Start",
        "End",
        "Voting Start",
        "Voting End",
        "Results Open",
    ]) {
        await expectTouchTarget(configuration.getByLabel(label, { exact: true }));
    }
    await setSeasonStatus(page, status, "Not Started");

    const nameInput = configuration.getByLabel("Theme Name", { exact: true });
    await expectTouchTarget(nameInput);
    const saveName = page.waitForResponse(
        (candidate) =>
            candidate.url().endsWith("/api/admin/hackathon") &&
            candidate.request().method() === "PATCH",
    );
    await nameInput.fill(secretName);
    await nameInput.press("Tab");
    expect((await saveName).ok()).toBeTruthy();

    const descriptionInput = configuration.getByLabel("Theme Description", { exact: true });
    await expectTouchTarget(descriptionInput);
    const saveDescription = page.waitForResponse(
        (candidate) =>
            candidate.url().endsWith("/api/admin/hackathon") &&
            candidate.request().method() === "PATCH",
    );
    await descriptionInput.fill(secretDescription);
    await descriptionInput.press("Tab");
    expect((await saveDescription).ok()).toBeTruthy();

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
    await expect(page.getByRole("heading", { name: "Hackathon Configuration" })).toBeVisible();
    await setSeasonStatus(page, status, "Paused");
    await expectUnreleasedThemeRedacted(page, request, "paused", secretName, secretDescription);
});
