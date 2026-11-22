import AxeBuilder from "@axe-core/playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
    expect,
    test,
    type Browser,
    type BrowserContext,
    type Locator,
    type Page,
} from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL;
if (!baseURL) throw new Error("Set PLAYWRIGHT_BASE_URL in .env for the browser tests.");
const accessibilityTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const responsiveWidths = [320, 375, 768, 1024, 1440] as const;
const boardDemoEnabled = process.env.BOARD_DEMO_CAPTURE === "1";
const boardDemoDir = resolve(process.cwd(), "artifacts/board-demo/captures");

async function captureBoardDemo(page: Page, id: string, title: string) {
    if (!boardDemoEnabled) return;
    const originalViewport = page.viewportSize();
    await page.setViewportSize({ width: 1440, height: 960 });
    await mkdir(boardDemoDir, { recursive: true });
    const filename = `${id}.png`;
    await page.screenshot({ path: resolve(boardDemoDir, filename), fullPage: true });
    const manifestPath = resolve(boardDemoDir, "manifest.json");
    let chapters: { id: string; title: string; image: string }[] = [];
    try {
        chapters = JSON.parse(await readFile(manifestPath, "utf8"));
    } catch {
        // The first screenshot creates the capture manifest.
    }
    chapters = chapters.filter((chapter) => chapter.id !== id);
    chapters.push({ id, title, image: filename });
    await writeFile(manifestPath, `${JSON.stringify(chapters, null, 2)}\n`);
    if (originalViewport) await page.setViewportSize(originalViewport);
}

async function newMobilePage(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
    const context = await browser.newContext({
        baseURL,
        viewport: { width: 320, height: 900 },
    });
    return { context, page: await context.newPage() };
}

async function loginAs(page: Page, email: string, redirectPath: string) {
    await page.goto(`/api/login?redirect=${encodeURIComponent(redirectPath)}`);
    await expect(page.getByRole("heading", { name: "Choose a test identity" })).toBeVisible();
    const consentResponse = page.waitForResponse(
        (response) =>
            new URL(response.url()).pathname === "/authorize/consent" &&
            response.request().method() === "POST",
    );
    await page.getByRole("button").filter({ hasText: email }).click();
    const consent = await consentResponse;
    const consentBody = consent.status() === 302 ? "" : await consent.text();
    expect(
        consent.status(),
        `OIDC test provider consent failed with HTTP ${consent.status()}: ${consentBody}`,
    ).toBe(302);
    await expect(page).toHaveURL((url) => url.pathname === redirectPath);
}

async function expectResponsivePage(page: Page) {
    const originalViewport = page.viewportSize();
    try {
        for (const width of responsiveWidths) {
            console.info(`[responsive-a11y] ${new URL(page.url()).pathname} ${width}px`);
            await page.setViewportSize({ width, height: 900 });
            const dimensions = await page.evaluate(() => ({
                viewport: document.documentElement.clientWidth,
                document: document.documentElement.scrollWidth,
                body: document.body.scrollWidth,
            }));
            expect(dimensions.document, `document overflow at ${width}px`).toBeLessThanOrEqual(
                dimensions.viewport,
            );
            expect(dimensions.body, `body overflow at ${width}px`).toBeLessThanOrEqual(
                dimensions.viewport,
            );

            const results = await new AxeBuilder({ page }).withTags(accessibilityTags).analyze();
            expect(
                results.violations,
                `WCAG 2.2 AA violations at ${width}px: ${JSON.stringify(results.violations, null, 2)}`,
            ).toEqual([]);
            console.info(`[responsive-a11y-complete] ${new URL(page.url()).pathname} ${width}px`);
        }
    } finally {
        if (originalViewport) await page.setViewportSize(originalViewport);
    }
}

async function expectTouchTarget(target: Locator) {
    await expect(target).toBeVisible();
    const box = await target.boundingBox();
    expect(box).not.toBeNull();
    if (!box) throw new Error("The expected touch target is not visible.");
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
}

function apiResponse(page: Page, path: string, method: string) {
    return page.waitForResponse(
        (response) =>
            new URL(response.url()).pathname === path && response.request().method() === method,
        { timeout: 15_000 },
    );
}

async function openSeasonTab(page: Page, name: string) {
    const tab = page.getByRole("tab", { name, exact: true });
    await expect(tab).toBeVisible();
    if ((await tab.getAttribute("aria-selected")) !== "true") {
        await tab.click({ timeout: 15_000 });
    }
}

async function chooseSeason(page: Page, name: string) {
    const picker = page.getByRole("combobox").first();
    await picker.click({ timeout: 15_000 });
    await page.getByRole("option", { name, exact: true }).click({ force: true, timeout: 15_000 });
    await page.keyboard.press("Escape");
}

async function setSeasonStatus(page: Page, status: string) {
    const statusValues: Record<string, string> = {
        "Not Started": "not_started",
        "In Progress": "in_progress",
        Voting: "voting",
        Finished: "finished",
        Paused: "paused",
    };
    const value = statusValues[status] ?? status;
    const result = await page.evaluate(async (nextStatus) => {
        const response = await fetch("/api/admin/hackathon", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ season_id: 1, status: nextStatus }),
        });
        return { status: response.status, body: await response.text() };
    }, value);
    expect(result.status, `season status failed: ${result.body}`).toBe(200);
}

async function setSeasonCheckbox(page: Page, label: string, checked: boolean) {
    const fields: Record<string, string> = {
        "Voting Enabled": "voting_enabled",
        "Judging Open": "judging_open",
        "Results Published": "results_published",
        "Show Scores": "show_scores",
        "Show Ranking": "show_ranking",
    };
    const field = fields[label];
    if (!field) throw new Error(`Unknown season field: ${label}`);
    const result = await page.evaluate(
        async ({ key, value }) => {
            const response = await fetch("/api/admin/hackathon", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ season_id: 1, [key]: value ? 1 : 0 }),
            });
            return { status: response.status, body: await response.text() };
        },
        { key: field, value: checked },
    );
    expect(result.status, `${label} update failed: ${result.body}`).toBe(200);
}

async function setScoreCurve(page: Page, label: string) {
    await openSeasonTab(page, "Rubric");
    const section = page
        .getByRole("heading", { name: "Score display curve" })
        .locator("xpath=ancestor::section[1]");
    const selector = section.getByRole("combobox");
    await expectTouchTarget(selector);
    if ((await selector.innerText()).includes(label)) return;

    const saved = apiResponse(page, "/api/admin/seasons/1/score-curve", "PATCH");
    await selector.click();
    await page.getByRole("option", { name: label, exact: true }).click();
    expect((await saved).ok()).toBeTruthy();
}

async function createAndSubmitProject(
    page: Page,
    teamName: string,
    projectName: string,
    checkResponsiveLayouts = false,
    capturePrefix?: string,
) {
    await page.goto("/dashboard/teams");
    await expect(page.getByRole("heading", { name: "Create a team" })).toBeVisible();
    if (capturePrefix) {
        await captureBoardDemo(page, `${capturePrefix}-team`, "Create a participant team");
    }
    await page.getByLabel("Team name").fill(teamName);

    const createButton = page.getByRole("button", { name: "Create", exact: true });
    await expectTouchTarget(createButton);
    const teamCreation = page.waitForResponse(
        (response) =>
            new URL(response.url()).pathname === "/api/teams" &&
            response.request().method() === "POST",
    );
    await createButton.focus();
    await page.keyboard.press("Enter");
    const teamResponse = await teamCreation;
    expect(
        teamResponse.ok(),
        `team creation failed with HTTP ${teamResponse.status()}`,
    ).toBeTruthy();
    const teamResponseBody = (await teamResponse.json()) as {
        data?: { id: number; name: string };
        id?: number;
        name?: string;
    };
    const createdTeam = teamResponseBody.data ?? teamResponseBody;
    expect(createdTeam.name).toBe(teamName);
    const creatorMembership = await page.evaluate(async () => {
        const readApiData = async (path: string) => {
            const response = await fetch(path);
            if (!response.ok) throw new Error(`${path} failed with HTTP ${response.status}`);
            const payload = (await response.json()) as { data?: unknown };
            return payload && typeof payload === "object" && "data" in payload
                ? payload.data
                : payload;
        };
        const session = (await readApiData("/api/auth/session")) as {
            user?: { id: number };
        };
        if (!session.user?.id) throw new Error("The browser session did not include a user ID.");
        const user = (await readApiData(`/api/users/${session.user.id}`)) as {
            team?: { id: number; name: string } | null;
        };
        return user.team ? { id: user.team.id, name: user.team.name } : null;
    });
    expect(creatorMembership).toEqual({ id: createdTeam.id, name: teamName });
    await expect(page).toHaveURL((url) => url.pathname === "/dashboard");

    await page.goto("/dashboard/general");
    const nameInput = page.getByLabel("Project name");
    await expect(nameInput, "team membership should unlock the project form").toBeVisible({
        timeout: 15_000,
    });
    const descriptionInput = page.getByLabel("Project description");
    await nameInput.fill(projectName);
    await descriptionInput.fill(
        `${projectName} helps participants organize their work and understand each next step.`,
    );
    await page
        .getByLabel("Demo URL")
        .fill(`https://example.invalid/${encodeURIComponent(projectName)}`);
    await page
        .getByLabel("Repository URL")
        .fill(`https://github.com/e2e-fixtures/${encodeURIComponent(projectName)}`);
    await page
        .getByLabel("Demonstration video URL")
        .fill(`https://example.invalid/${encodeURIComponent(projectName)}.mp4`);
    await page
        .locator('textarea[name="project.sourcing"]')
        .fill("Original work created for the end-to-end journey.");
    if (capturePrefix) {
        await captureBoardDemo(page, `${capturePrefix}-project`, "Describe and submit a project");
    }

    const track = page.getByRole("radio").first();
    await expect(track).toBeEnabled();
    await track.click();
    await page
        .getByRole("checkbox", { name: /I have read the rules and confirm my submission/ })
        .check();

    if (checkResponsiveLayouts) await expectResponsivePage(page);
    const submitButton = page.locator("#project-submit");
    await expectTouchTarget(submitButton);
    await expect(submitButton).toBeEnabled();
    await submitButton.click();
    await expect(
        page.getByRole("heading", { name: "Confirm submission", exact: true }),
    ).toBeVisible();

    const submission = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
            /^\/api\/teams\/\d+\/submit$/.test(url.pathname) &&
            response.request().method() === "POST"
        );
    });
    const confirmButton = page.getByRole("button", { name: "Confirm", exact: true });
    await expectTouchTarget(confirmButton);
    await confirmButton.click();
    expect((await submission).ok()).toBeTruthy();
    await expect(page.getByText("You have submitted your project. Congratulations!")).toBeVisible();
    if (capturePrefix) {
        await captureBoardDemo(page, `${capturePrefix}-submitted`, "Project submitted");
    }
}

async function setJudgeScores(page: Page, value: string) {
    const groups = page.getByRole("radiogroup");
    const count = await groups.count();
    expect(count).toBeGreaterThan(0);

    for (let index = 0; index < count; index += 1) {
        const group = groups.nth(index);
        const option = group.getByRole("radio", {
            name: new RegExp(`^${value} of \\d+ for`),
        });
        if (index === 0) await expectTouchTarget(option.locator("xpath=.."));
        await option.focus();
        await page.keyboard.press("Space");
        await expect(option).toBeChecked();
    }
}

async function pressWithKeyboard(page: Page, target: Locator, key = "Enter") {
    await target.focus({ timeout: 15_000 });
    await expect(target).toBeFocused();
    await page.keyboard.press(key);
}

async function replaceTextWithKeyboard(page: Page, target: Locator, value: string) {
    await target.focus();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.type(value);
}

async function beginKeyboardOnlyAudit(page: Page) {
    await page.evaluate(() => {
        const audit = { pointerEvents: 0, keyEvents: 0 };
        (window as Window & { __keyboardOnlyAudit?: typeof audit }).__keyboardOnlyAudit = audit;
        document.addEventListener("pointerdown", () => audit.pointerEvents++, true);
        document.addEventListener("mousedown", () => audit.pointerEvents++, true);
        document.addEventListener("keydown", () => audit.keyEvents++, true);
    });
}

async function expectKeyboardOnlyAudit(page: Page) {
    const audit = await page.evaluate(
        () =>
            (
                window as Window & {
                    __keyboardOnlyAudit?: { pointerEvents: number; keyEvents: number };
                }
            ).__keyboardOnlyAudit,
    );
    expect(audit?.pointerEvents).toBe(0);
    expect(audit?.keyEvents).toBeGreaterThan(0);
}

async function getTeamIdByProject(page: Page, projectName: string): Promise<number> {
    const teams = await page.evaluate(async () => {
        const response = await fetch("/api/teams?season_id=1");
        if (!response.ok) throw new Error(`Could not load season teams: ${response.status}`);
        const result = (await response.json()) as {
            data?: {
                id: number;
                project: { name: string };
            }[];
        };
        if (!Array.isArray(result.data)) {
            throw new Error(
                "Could not load season teams: the response did not contain a team list.",
            );
        }
        return result.data as {
            id: number;
            project: { name: string };
        }[];
    });
    const team = teams.find((item) => item.project.name === projectName);
    expect(team, `Could not find the team for ${projectName}`).toBeDefined();
    if (!team) throw new Error(`Could not find the team for ${projectName}`);
    return team.id;
}

function scoreSubmission(page: Page, teamId: number) {
    return page.waitForResponse(
        (response) =>
            new URL(response.url()).pathname === `/api/teams/${teamId}/scores` &&
            response.request().method() === "POST",
    );
}

async function fetchApiJson(page: Page, path: string, init?: RequestInit) {
    return page.evaluate(
        async (requestPath) => {
            const response = await fetch(requestPath.path, requestPath.init);
            const value = (await response.json()) as unknown;
            const body =
                value && typeof value === "object" && "data" in value
                    ? (value as { data: unknown }).data
                    : value;
            return { status: response.status, body };
        },
        { path, init },
    );
}

async function expectPublicResultsHidden(page: Page, teamId: number) {
    const [feedback, team] = await Promise.all([
        fetchApiJson(page, `/api/teams/${teamId}/scores`),
        fetchApiJson(page, `/api/teams/${teamId}`),
    ]);

    expect(feedback.status).toBe(200);
    expect(feedback.body).toMatchObject({
        team_id: teamId,
        original_score: null,
        displayed_score: null,
        rank: null,
        feedback: [],
        feedback_withheld_for_anonymity: true,
    });
    expect(team.status).toBe(200);
    expect(team.body).toMatchObject({ id: teamId, score: null, rank: null });
}

async function recomputeSeasonScores(page: Page) {
    const result = await page.evaluate(async () => {
        const response = await fetch("/api/admin/scores/compute?season_id=1", {
            method: "POST",
        });
        return { status: response.status, body: await response.json() };
    });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
        data: { message: "Scores and ranks were recomputed." },
    });
}

async function evaluateProject(
    page: Page,
    projectName: string,
    comment: string,
    score: string,
): Promise<void> {
    await page.goto("/judging");
    await expect(page.getByRole("heading", { name: "Judging", exact: true })).toBeVisible();
    await pressWithKeyboard(page, page.getByRole("button", { name: /Continue judging/ }));
    await expect(page).toHaveURL((url) => url.pathname === "/judging/continue");
    await expect(page.getByRole("heading", { name: "Judge projects" })).toBeVisible();
    await navigateToProject(page, projectName);

    const commentInput = page.getByRole("textbox", {
        name: "Anonymous feedback and score rationale",
    });
    await replaceTextWithKeyboard(page, commentInput, comment);
    await setJudgeScores(page, score);
    await pressWithKeyboard(page, page.getByRole("button", { name: "Review evaluation" }));
    await expect(page.getByRole("heading", { name: "Review before you finalize" })).toBeVisible();

    const teamId = await getTeamIdByProject(page, projectName);
    const evaluation = scoreSubmission(page, teamId);
    await pressWithKeyboard(page, page.getByRole("button", { name: "Finalize evaluation" }));
    const response = await evaluation;
    expect(
        response.ok(),
        `score submission failed with HTTP ${response.status()}: ${await response.text()}`,
    ).toBeTruthy();
}

async function navigateToProject(page: Page, projectName: string) {
    await expect(page.getByRole("dialog", { name: "Review before you finalize" })).toBeHidden();
    const currentProject = page.getByRole("main").getByRole("heading", { level: 2 });
    for (let visited = 0; visited < 100; visited += 1) {
        if ((await currentProject.textContent())?.trim() === projectName) return;

        const nextProject = page.getByRole("button", { name: "Next project" });
        if (!(await nextProject.isEnabled())) {
            const currentName =
                (await currentProject.textContent())?.trim() ?? "project unavailable";
            throw new Error(`Could not reach judging project ${projectName} from ${currentName}.`);
        }
        const previousName = (await currentProject.textContent())?.trim();
        await pressWithKeyboard(page, nextProject);
        await expect
            .poll(async () => (await currentProject.textContent())?.trim())
            .not.toBe(previousName);
    }

    throw new Error(`Could not find ${projectName} in the first 100 judging projects.`);
}

test("participant and admin complete mobile journeys while judging and review stay keyboard-only", async ({
    browser,
}) => {
    test.setTimeout(720_000);
    const suffix = Date.now().toString(36);
    const adminTeam = `E2E ${suffix} Admin team`;
    const participantTeam = `E2E ${suffix} Participant team`;
    const judgeTeam = `E2E ${suffix} Judge team`;
    const adminProject = `E2E ${suffix} Organizer project`;
    const participantProject = `E2E ${suffix} Participant project`;
    const judgeProject = `E2E ${suffix} Judge project`;
    const comment =
        "The project presents a clear core idea. Add a short progress cue so first-time users can see what remains.";

    const admin = await newMobilePage(browser);
    const participant = await newMobilePage(browser);
    const judge = await newMobilePage(browser);
    const judgeTwo = await newMobilePage(browser);
    const judgeThree = await newMobilePage(browser);
    let progress = "opening the administrator session";
    const markProgress = (stage: string) => {
        progress = stage;
        console.info(`[role-journey] ${stage}`);
    };

    try {
        if (boardDemoEnabled) {
            await mkdir(boardDemoDir, { recursive: true });
            await writeFile(resolve(boardDemoDir, "manifest.json"), "[]\n");
        }
        await admin.page.goto("/");
        await expect(admin.page.locator('link[rel="canonical"]')).toHaveAttribute(
            "href",
            `${baseURL}/`,
        );
        await captureBoardDemo(admin.page, "01-home", "Public home");
        await admin.page.goto("/showcase");
        await expect(admin.page.locator('link[rel="canonical"]')).toHaveAttribute(
            "href",
            `${baseURL}/showcase`,
        );
        await captureBoardDemo(admin.page, "02-showcase", "Public showcase");
        markProgress("configuring the season and reusable rubric");
        await loginAs(admin.page, "admin@e2e.basishacks.invalid", "/developers/season");
        const { body: session } = (await fetchApiJson(admin.page, "/api/auth/session")) as {
            body: { user: { id: number } };
        };
        const picture = await admin.page.request.get(
            `/api/users/${session.user.id}/profile_picture`,
        );
        expect(picture.ok()).toBe(true);
        expect(picture.headers()["content-type"]).toBe("image/gif");
        expect((await picture.body()).subarray(0, 6).toString()).toBe("GIF89a");
        await openSeasonTab(admin.page, "Season settings");
        await expect(admin.page.getByRole("heading", { name: "Season settings" })).toBeVisible();
        await captureBoardDemo(admin.page, "03-admin-season", "Administrator season management");
        await openSeasonTab(admin.page, "Seasons");
        await chooseSeason(admin.page, "Next season");
        await expect(admin.page.getByRole("button", { name: "Record approval" })).toBeVisible();
        const seededSeasonPayload = (await fetchApiJson(admin.page, "/api/admin/hackathon"))
            .body as {
            seasons: {
                id: number;
                name: string;
                is_active: number;
                is_blank_start: number;
                status: string;
                theme_name: string | null;
                start_timestamp: number;
                end_timestamp: number;
                rubric_version_id: number | null;
                board_approved_at: string | null;
                board_approved_by: number | null;
            }[];
        };
        const seededSeasons = seededSeasonPayload.seasons;
        const nextSeasonShell = seededSeasons.find((season) => season.name === "Next season");
        expect(nextSeasonShell).toMatchObject({
            is_active: 0,
            is_blank_start: 1,
            status: "not_started",
            theme_name: null,
            start_timestamp: 0,
            end_timestamp: 0,
            rubric_version_id: null,
            board_approved_at: null,
            board_approved_by: null,
        });
        await captureBoardDemo(
            admin.page,
            "03-r1-shell",
            "The next season waits for dates, theme, rubric, and approval",
        );
        const activeSeasonName = seededSeasons.find((season) => season.is_active === 1)?.name;
        if (!activeSeasonName) throw new Error("The E2E database has no active season.");
        await admin.page.goto("/developers/season");
        await openSeasonTab(admin.page, "Season settings");
        markProgress("checking the administrator layout at all required widths");
        await expectResponsivePage(admin.page);

        markProgress("configuring season-specific judge comment guidance and prompts");
        await openSeasonTab(admin.page, "Rubric");
        const customGuideline =
            "Describe observable project details so feedback stays specific and useful.";
        await admin.page.getByRole("textbox", { name: "Guideline 1" }).fill(customGuideline);
        await admin.page.getByLabel("Template 1 label").fill("Evidence + next step");
        await admin.page
            .getByLabel("Template 1 text")
            .fill("Evidence I observed: {{specific detail}}\nNext step: {{action and reason}}");
        await admin.page.getByLabel("New rubric version name").fill(`E2E season rubric ${suffix}`);
        const rubricVersionResponse = apiResponse(
            admin.page,
            "/api/admin/seasons/1/rubric",
            "POST",
        );
        await admin.page.getByRole("button", { name: "Save new version" }).click();
        const savedRubricVersion = await rubricVersionResponse;
        expect(savedRubricVersion.ok()).toBeTruthy();
        expect(await savedRubricVersion.json()).toMatchObject({
            data: {
                active: {
                    definition: {
                        commentGuidance: {
                            guidelines: expect.arrayContaining([customGuideline]),
                            templates: expect.arrayContaining([
                                expect.objectContaining({ label: "Evidence + next step" }),
                            ]),
                        },
                    },
                },
            },
        });

        markProgress("saving the reusable rubric template");
        const templateName = `E2E rubric template ${suffix}`;
        await admin.page
            .getByPlaceholder("For example, Project showcase rubric")
            .fill(templateName);
        const templateSave = apiResponse(admin.page, "/api/admin/rubric-templates", "POST");
        const templateRefresh = apiResponse(admin.page, "/api/admin/seasons/1/rubric", "GET");
        const templateSavedToast = expect(
            admin.page.getByText("Reusable template saved.", { exact: true }),
        ).toBeVisible();
        await admin.page.getByRole("button", { name: "Save as new template" }).click();
        const [templateResponse] = await Promise.all([templateSave, templateSavedToast]);
        expect(templateResponse.ok()).toBeTruthy();
        expect(await templateResponse.json()).toMatchObject({
            data: { template: { name: templateName } },
        });
        const refreshedRubric = await templateRefresh;
        expect(await refreshedRubric.json()).toMatchObject({
            data: {
                templates: expect.arrayContaining([
                    expect.objectContaining({ name: templateName }),
                ]),
            },
        });
        await expect(
            admin.page.getByRole("heading", { name: templateName, exact: true }),
        ).toBeVisible();

        markProgress("setting the score curve and season status");
        await setScoreCurve(admin.page, "Strong uplift");
        await setSeasonStatus(admin.page, "In Progress");
        markProgress("creating the administrator project");
        await createAndSubmitProject(admin.page, adminTeam, adminProject);

        markProgress("creating the participant project");
        await loginAs(participant.page, "participant@e2e.basishacks.invalid", "/dashboard/teams");
        await createAndSubmitProject(
            participant.page,
            participantTeam,
            participantProject,
            true,
            "04-participant",
        );

        markProgress("creating the judge project");
        await loginAs(judgeTwo.page, "judge-two@e2e.basishacks.invalid", "/dashboard/teams");
        await createAndSubmitProject(judgeTwo.page, judgeTeam, judgeProject);

        const adminTeamId = await getTeamIdByProject(admin.page, adminProject);
        const participantTeamId = await getTeamIdByProject(admin.page, participantProject);

        await admin.page.goto("/developers/season");
        await setSeasonStatus(admin.page, "Voting");
        await setSeasonCheckbox(admin.page, "Voting Enabled", true);
        await setSeasonCheckbox(admin.page, "Judging Open", true);
        await expectResponsivePage(admin.page);

        markProgress("submitting the participant peer vote");
        await participant.page.goto("/voting");
        await expect(participant.page.getByRole("heading", { name: "Peer voting" })).toBeVisible();
        await captureBoardDemo(participant.page, "05-peer-voting", "Peer voting");
        const otherProjects = [adminProject, judgeProject];
        for (const projectName of otherProjects) {
            const projectHeading = participant.page.getByRole("heading", {
                level: 2,
                name: projectName,
            });
            await expect(projectHeading).toBeVisible();
            const projectCard = projectHeading.locator("xpath=ancestor::div[.//button][1]");
            const increment = projectCard.getByRole("button", {
                name: `Add a star to ${projectName}`,
            });
            await expectTouchTarget(increment);
            for (let star = 0; star < 5; star += 1) await increment.click();
        }
        await participant.page
            .getByLabel("Your reasoning")
            .fill("Both projects communicate their ideas clearly and show thoughtful iteration.");
        await expectResponsivePage(participant.page);
        const voteSubmit = participant.page.getByRole("button", { name: "Submit", exact: true });
        await expectTouchTarget(voteSubmit);
        await expect(voteSubmit).toBeEnabled();
        participant.page.once("dialog", (dialog) => dialog.accept());
        const voteSubmission = apiResponse(participant.page, "/api/ballot", "POST");
        await voteSubmit.click();
        expect((await voteSubmission).ok()).toBeTruthy();
        await expect(
            participant.page.getByText(
                "You have voted. You can update your ballot until voting closes.",
            ),
        ).toBeVisible();

        await loginAs(judge.page, "judge@e2e.basishacks.invalid", "/judging");
        await expect(
            judge.page.getByRole("heading", { name: "Judging", exact: true }),
        ).toBeVisible();
        await beginKeyboardOnlyAudit(judge.page);
        await pressWithKeyboard(
            judge.page,
            judge.page.getByRole("button", { name: /Continue judging/ }),
        );
        await expect(judge.page).toHaveURL((url) => url.pathname === "/judging/continue");
        await expect(judge.page.getByRole("heading", { name: "Judge projects" })).toBeVisible();
        markProgress("finding the administrator project in the judge queue");
        await navigateToProject(judge.page, adminProject);
        await captureBoardDemo(judge.page, "06-judge-scoring", "Judge project scoring");
        await expect(judge.page.getByRole("button", { name: "Next project" })).toBeEnabled();
        await expectResponsivePage(judge.page);
        await judge.page.setViewportSize({ width: 1280, height: 900 });
        try {
            const projectPane = judge.page.getByRole("region", { name: adminProject });
            const rubricPane = judge.page.getByRole("region", { name: "Scoring Guidelines" });
            await expect(projectPane).toHaveCSS("overflow-y", "auto");
            await expect(rubricPane).toHaveCSS("overflow-y", "auto");
            const projectBox = await projectPane.boundingBox();
            const rubricBox = await rubricPane.boundingBox();
            const mainBox = await judge.page.getByRole("main").boundingBox();
            const divider = judge.page.getByRole("separator", {
                name: "Resize the project details and scoring panes",
            });
            if (!projectBox || !rubricBox || !mainBox)
                throw new Error("Judging workspace is hidden");
            await expect(divider).toBeVisible();
            expect(projectBox.x).toBe(0);
            expect(projectBox.y).toBeGreaterThan(mainBox.y);
            expect(projectBox.x + projectBox.width).toBeLessThan(rubricBox.x);
            expect(rubricBox.x).toBeGreaterThan(mainBox.x + mainBox.width / 2);
            expect(rubricBox.x + rubricBox.width).toBeCloseTo(mainBox.x + mainBox.width, 0);
            expect(rubricBox.y + rubricBox.height).toBeCloseTo(mainBox.y + mainBox.height, 0);

            await divider.focus();
            await divider.press("ArrowRight");
            await expect
                .poll(async () => (await projectPane.boundingBox())?.width ?? 0)
                .toBeGreaterThan(projectBox.width);
            const shiftedRubricBox = await rubricPane.boundingBox();
            if (!shiftedRubricBox)
                throw new Error("Judging rubric pane disappeared after resizing");
            expect(shiftedRubricBox.x).toBeGreaterThan(rubricBox.x);
        } finally {
            await judge.page.setViewportSize({ width: 320, height: 900 });
        }

        await expect(judge.page.getByText(customGuideline, { exact: true })).toBeVisible();
        const firstPrompt = judge.page.getByRole("button", { name: "Evidence + next step" });
        markProgress("saving and restoring the judge draft");
        await expectTouchTarget(firstPrompt);
        await expect(firstPrompt).toBeEnabled();
        await pressWithKeyboard(judge.page, firstPrompt);
        const commentInput = judge.page.getByRole("textbox", {
            name: "Anonymous feedback and score rationale",
        });
        await expect(commentInput).toHaveValue(/Evidence I observed/);
        await replaceTextWithKeyboard(judge.page, commentInput, comment);
        await replaceTextWithKeyboard(
            judge.page,
            commentInput,
            `${comment} judge@e2e.basishacks.invalid`,
        );
        await expect(
            judge.page.getByText(
                "Remove your email address or display name from the comment to keep it anonymous.",
                { exact: true },
            ),
        ).toBeVisible();
        await expect(judge.page.getByRole("button", { name: "Review evaluation" })).toBeDisabled();
        await replaceTextWithKeyboard(judge.page, commentInput, comment);
        await setJudgeScores(judge.page, "3");
        await expect(judge.page.getByRole("button", { name: "Review evaluation" })).toBeEnabled();
        await expect(judge.page.getByText(/Draft saved/)).toBeVisible();
        await expectKeyboardOnlyAudit(judge.page);

        await judge.page.reload();
        await expect(judge.page.getByRole("heading", { name: "Judge projects" })).toBeVisible();
        await beginKeyboardOnlyAudit(judge.page);
        await navigateToProject(judge.page, adminProject);
        await expect(
            judge.page.getByRole("textbox", { name: "Anonymous feedback and score rationale" }),
        ).toHaveValue(comment);
        await expect(judge.page.getByRole("radio", { name: /3 of 5 for/ })).toHaveCount(5);
        for (const savedScore of await judge.page
            .getByRole("radio", { name: /3 of 5 for/ })
            .all()) {
            await expect(savedScore).toBeChecked();
        }

        await pressWithKeyboard(
            judge.page,
            judge.page.getByRole("button", { name: "Next project" }),
        );
        await expect(judge.page.getByRole("heading", { name: participantProject })).toBeVisible();
        await pressWithKeyboard(
            judge.page,
            judge.page.getByRole("button", { name: "Previous project" }),
        );
        await expect(judge.page.getByRole("heading", { name: adminProject })).toBeVisible();
        await expect(commentInput).toHaveValue(comment);

        const reviewButton = judge.page.getByRole("button", { name: "Review evaluation" });
        const reviewDialog = judge.page.getByRole("dialog", { name: "Review before you finalize" });
        await pressWithKeyboard(judge.page, reviewButton);
        await expect(reviewDialog).toBeVisible();
        await judge.page.keyboard.press("Escape");
        await expect(reviewDialog).toBeHidden();
        await expect(reviewButton).toBeFocused();
        await expect(commentInput).toHaveValue(comment);
        await pressWithKeyboard(judge.page, reviewButton);
        markProgress("finalizing the administrator evaluation");
        await expect(reviewDialog).toBeVisible();
        await expect(judge.page.getByText(/your identity will not be shown/i)).toBeVisible();
        await expectResponsivePage(judge.page);
        const firstEvaluation = scoreSubmission(judge.page, adminTeamId);
        await pressWithKeyboard(
            judge.page,
            judge.page.getByRole("button", { name: "Finalize evaluation" }),
        );
        expect((await firstEvaluation).ok()).toBeTruthy();

        markProgress("wrapping the judge queue after scoring its last pending project");
        await navigateToProject(judge.page, judgeProject);
        await expect(judge.page.getByRole("button", { name: "Next project" })).toBeDisabled();
        const lastProjectComment =
            "The project states its goal clearly. Add one example to show how the team will measure progress.";
        await replaceTextWithKeyboard(
            judge.page,
            judge.page.getByRole("textbox", { name: "Anonymous feedback and score rationale" }),
            lastProjectComment,
        );
        await setJudgeScores(judge.page, "2");
        await pressWithKeyboard(
            judge.page,
            judge.page.getByRole("button", { name: "Review evaluation" }),
        );
        await expect(
            judge.page.getByRole("heading", { name: "Review before you finalize" }),
        ).toBeVisible();
        const lastProjectTeamId = await getTeamIdByProject(judge.page, judgeProject);
        const lastEvaluation = scoreSubmission(judge.page, lastProjectTeamId);
        await pressWithKeyboard(
            judge.page,
            judge.page.getByRole("button", { name: "Finalize evaluation" }),
        );
        expect((await lastEvaluation).ok()).toBeTruthy();
        await expect(reviewDialog).toBeHidden();
        await expect(
            judge.page.getByRole("heading", { level: 2, name: participantProject }),
        ).toBeVisible();

        markProgress("finalizing the participant evaluation");
        const participantComment =
            "The helpful onboarding flow makes the main task easy to understand. Add one example so new users can get started faster.";
        const participantCommentInput = judge.page.getByRole("textbox", {
            name: "Anonymous feedback and score rationale",
        });
        await replaceTextWithKeyboard(judge.page, participantCommentInput, participantComment);
        await setJudgeScores(judge.page, "4");
        await expect(judge.page.getByRole("button", { name: "Review evaluation" })).toBeEnabled();
        await pressWithKeyboard(
            judge.page,
            judge.page.getByRole("button", { name: "Review evaluation" }),
        );
        await expect(
            judge.page.getByRole("heading", { name: "Review before you finalize" }),
        ).toBeVisible();
        const secondEvaluation = scoreSubmission(judge.page, participantTeamId);
        await pressWithKeyboard(
            judge.page,
            judge.page.getByRole("button", { name: "Finalize evaluation" }),
        );
        expect((await secondEvaluation).ok()).toBeTruthy();
        await expectKeyboardOnlyAudit(judge.page);

        await participant.page.goto("/dashboard/results");
        await expect(participant.page.getByText(participantComment, { exact: true })).toHaveCount(
            0,
        );
        await expect(participant.page.getByText("Judge feedback", { exact: true })).toHaveCount(0);

        await admin.page.goto("/developers/season");
        markProgress("publishing results while one review exists and checking anonymity gate");
        await setSeasonCheckbox(admin.page, "Results Published", true);
        await setSeasonCheckbox(admin.page, "Show Scores", true);
        await setSeasonCheckbox(admin.page, "Show Ranking", true);
        await recomputeSeasonScores(admin.page);

        await participant.page.goto("/dashboard/results");
        await expectPublicResultsHidden(participant.page, participantTeamId);
        await expect(
            participant.page.getByText(
                /Written feedback is hidden until at least three judges have evaluated this project/,
            ),
        ).toBeVisible();
        await expect(participant.page.getByText("original score", { exact: true })).toHaveCount(0);
        await expect(participant.page.getByText(/Curved display \(Strong uplift\):/)).toHaveCount(
            0,
        );
        await expect(participant.page.getByText(participantComment, { exact: true })).toHaveCount(
            0,
        );

        markProgress("checking anonymity after a second judge evaluation");
        await setSeasonCheckbox(admin.page, "Results Published", false);
        await setSeasonCheckbox(admin.page, "Judging Open", true);
        await loginAs(judgeTwo.page, "judge-two@e2e.basishacks.invalid", "/judging");
        const secondJudgeComment =
            "The navigation is clear. Add one example to help first-time visitors understand the next step.";
        await evaluateProject(judgeTwo.page, participantProject, secondJudgeComment, "4");
        await setSeasonCheckbox(admin.page, "Results Published", true);
        await recomputeSeasonScores(admin.page);
        await participant.page.goto("/dashboard/results");
        await expectPublicResultsHidden(participant.page, participantTeamId);
        await expect(
            participant.page.getByText(
                /Written feedback is hidden until at least three judges have evaluated this project/,
            ),
        ).toBeVisible();
        await expect(participant.page.getByText(secondJudgeComment, { exact: true })).toHaveCount(
            0,
        );

        markProgress("releasing anonymous feedback after a third judge evaluation");
        await setSeasonCheckbox(admin.page, "Results Published", false);
        await setSeasonCheckbox(admin.page, "Judging Open", true);
        await loginAs(judgeThree.page, "judge-three@e2e.basishacks.invalid", "/judging");
        const thirdJudgeComment =
            "The project explains its purpose well. Add a concrete example to make the benefits easier to picture.";
        await evaluateProject(judgeThree.page, participantProject, thirdJudgeComment, "4");
        await setSeasonCheckbox(admin.page, "Results Published", true);
        await recomputeSeasonScores(admin.page);
        await admin.page.goto("/developers/season");
        await setSeasonStatus(admin.page, "Finished");

        await participant.page.goto("/dashboard/results");
        const visibleTeam = await fetchApiJson(participant.page, `/api/teams/${participantTeamId}`);
        expect(visibleTeam.status).toBe(200);
        expect(visibleTeam.body).toMatchObject({ id: participantTeamId, score: 80, rank: 1 });
        const publicFeedback = await fetchApiJson(
            participant.page,
            `/api/teams/${participantTeamId}/scores`,
        );
        expect(publicFeedback.status).toBe(200);
        expect(publicFeedback.body).toMatchObject({
            original_score: 80,
            displayed_score: 86,
        });
        const publicComments = (
            publicFeedback.body as { feedback: { reasoning: string }[] }
        ).feedback.map((entry) => entry.reasoning);
        expect(publicComments).toEqual(
            expect.arrayContaining([participantComment, secondJudgeComment, thirdJudgeComment]),
        );
        expect(
            (publicFeedback.body as { feedback: Record<string, unknown>[] }).feedback.every(
                (entry) => Object.keys(entry).sort().join() === "created_at,reasoning",
            ),
        ).toBe(true);
        expect(JSON.stringify(publicFeedback.body)).not.toMatch(
            /judge(?:-two|-three)?@e2e|judge_(?:user_id|name)|rubric_name|normalized_score/,
        );

        const originalScore = participant.page.getByText("original score", { exact: true });
        await expect(originalScore.locator("xpath=..")).toContainText("80/100");
        await expect(participant.page.getByText(/Curved display \(Strong uplift\):/)).toContainText(
            "86/100",
        );
        await expect(participant.page.getByText(participantComment, { exact: true })).toBeVisible();
        await expect(participant.page.getByText(secondJudgeComment, { exact: true })).toBeVisible();
        await expect(participant.page.getByText(thirdJudgeComment, { exact: true })).toBeVisible();
        const anonymousEvaluationHeadings = participant.page.getByRole("heading", {
            name: "Anonymous evaluation",
            exact: true,
        });
        await expect(anonymousEvaluationHeadings).toHaveCount(3);
        for (const heading of await anonymousEvaluationHeadings.all()) {
            await expect(heading).toBeVisible();
        }
        await expect(
            participant.page.getByText(
                "Judge names, account IDs, rubric metadata, and individual scores are hidden.",
            ),
        ).toBeVisible();
        await expect(participant.page.getByText("Judge Fixture", { exact: false })).toHaveCount(0);
        await expect(
            participant.page.getByText("judge@e2e.basishacks.invalid", { exact: false }),
        ).toHaveCount(0);
        await expectResponsivePage(participant.page);
        await captureBoardDemo(participant.page, "07-results", "Published participant results");
        const successor = await fetchApiJson(admin.page, "/api/admin/seasons", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name: `E2E archive successor ${suffix}`,
                copy_live_settings: true,
                is_active: 1,
            }),
        });
        expect(successor.status).toBe(200);
        const successorSeasons = (
            successor.body as { seasons: { name: string; is_active: number }[] }
        ).seasons;
        expect(
            successorSeasons.find((season) => season.name === `E2E archive successor ${suffix}`)
                ?.is_active,
        ).toBe(1);
        await participant.page.goto("/showcase");
        await captureBoardDemo(participant.page, "08-project-archive", "Public project archive");
        await participant.page.goto("/showcase/seasons/1");
        await expect(
            participant.page.getByRole("heading", { name: "Submitted projects", exact: true }),
        ).toBeVisible();
        await expect(
            participant.page.getByRole("heading", { name: participantProject, exact: true }),
        ).toBeVisible();
        await captureBoardDemo(participant.page, "09-season-archive", "Completed season projects");
        const restoreActive = await fetchApiJson(admin.page, "/api/admin/seasons", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: 1, is_active: 1 }),
        });
        expect(restoreActive.status).toBe(200);

        await admin.page.goto("/developers/teams");
        markProgress("checking the administrator feedback view");
        await admin.page.getByPlaceholder("Filter names...").fill(participantTeam);
        const participantRow = admin.page.getByRole("row").filter({ hasText: participantTeam });
        await participantRow.getByRole("button", { name: "View", exact: true }).click();
        const feedbackDialog = admin.page.getByRole("dialog");
        await expect(feedbackDialog.getByText(participantComment, { exact: true })).toBeVisible();
        await captureBoardDemo(admin.page, "10-admin-review", "Administrator review and feedback");
        await expect(feedbackDialog.getByText(secondJudgeComment, { exact: true })).toBeVisible();
        await expect(feedbackDialog.getByText(thirdJudgeComment, { exact: true })).toBeVisible();
        await expect(feedbackDialog.getByText("Original average:")).toContainText("80/100");
        await expect(feedbackDialog.getByText(/Curved display \(Strong uplift\):/)).toContainText(
            "86/100",
        );
        await expect(
            feedbackDialog.getByText(
                "Judge names and account IDs are visible only in this admin view.",
            ),
        ).toBeVisible();
        for (const judgeName of ["Judge Fixture", "Judge Two Fixture", "Judge Three Fixture"]) {
            await expect(feedbackDialog.getByRole("heading", { name: judgeName })).toBeVisible();
        }
        const adminFeedback = await fetchApiJson(
            admin.page,
            `/api/admin/teams/${participantTeamId}/scores`,
        );
        expect(adminFeedback.status).toBe(200);
        expect(
            (adminFeedback.body as { feedback: { judge_name?: string }[] }).feedback.map(
                (entry) => entry.judge_name,
            ),
        ).toEqual(
            expect.arrayContaining(["Judge Fixture", "Judge Two Fixture", "Judge Three Fixture"]),
        );
        await expectResponsivePage(admin.page);
    } finally {
        console.info(`[role-journey] cleanup after ${progress}`);
        await Promise.all([
            admin.context.close(),
            participant.context.close(),
            judge.context.close(),
            judgeTwo.context.close(),
            judgeThree.context.close(),
        ]);
    }
});
