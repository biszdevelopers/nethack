import AxeBuilder from "@axe-core/playwright";
import {
    expect,
    test,
    type Browser,
    type BrowserContext,
    type Locator,
    type Page,
} from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3005";
const accessibilityTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const responsiveWidths = [320, 375, 768, 1024, 1440] as const;

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

async function setSeasonStatus(page: Page, status: string) {
    const configuration = page
        .getByRole("heading", { name: "Hackathon Configuration" })
        .locator("xpath=ancestor::section[1]");
    const selector = configuration.getByRole("combobox").first();
    await expectTouchTarget(selector);
    if ((await selector.innerText()).trim().includes(status)) return;

    const saved = apiResponse(page, "/api/admin/hackathon", "PATCH");
    await selector.click();
    await page.getByRole("option", { name: status, exact: true }).click();
    expect((await saved).ok()).toBeTruthy();
}

async function setSeasonCheckbox(page: Page, label: string, checked: boolean) {
    const configuration = page
        .getByRole("heading", { name: "Hackathon Configuration" })
        .locator("xpath=ancestor::section[1]");
    const checkbox = configuration.getByRole("checkbox", { name: label });
    const checkboxId = await checkbox.getAttribute("id");
    expect(checkboxId).toBeTruthy();
    if (!checkboxId) throw new Error(`The ${label} checkbox has no associated label.`);
    await expectTouchTarget(configuration.locator(`label[for="${checkboxId}"]`));
    if ((await checkbox.isChecked()) === checked) return;

    const saved = apiResponse(page, "/api/admin/hackathon", "PATCH");
    if (checked) await checkbox.check();
    else await checkbox.uncheck();
    expect((await saved).ok()).toBeTruthy();
}

async function setScoreCurve(page: Page, label: string) {
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
) {
    await page.goto("/dashboard/teams");
    await expect(page.getByRole("heading", { name: "Create a team" })).toBeVisible();
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
    expect(new URL(teamResponse.url()).searchParams.get("add")).toBe("true");
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

    const track = page.getByRole("radio").first();
    await expect(track).toBeEnabled();
    await track.click();

    if (checkResponsiveLayouts) await expectResponsivePage(page);
    const submitButton = page.locator("#project-submit");
    await expectTouchTarget(submitButton);
    await expect(submitButton).toBeEnabled();
    await submitButton.click();
    await expect(
        page.getByText("Confirm submission to your project?", { exact: false }),
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
    await target.focus();
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

async function fetchApiJson(page: Page, path: string) {
    return page.evaluate(async (requestPath) => {
        const response = await fetch(requestPath);
        const value = (await response.json()) as unknown;
        const body =
            value && typeof value === "object" && "data" in value
                ? (value as { data: unknown }).data
                : value;
        return { status: response.status, body };
    }, path);
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

    const commentInput = page.getByLabel("Anonymous feedback and score rationale");
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
    const currentProject = page.getByRole("heading", { level: 2 });
    for (let visited = 0; visited < 100; visited += 1) {
        if ((await currentProject.textContent())?.trim() === projectName) return;

        const nextProject = page.getByRole("button", { name: "Next project" });
        if (!(await nextProject.isEnabled())) {
            const progress = await page
                .getByText(/Project \d+ of \d+/)
                .first()
                .textContent()
                .catch(() => "progress unavailable");
            const currentName =
                (await currentProject.textContent())?.trim() ?? "project unavailable";
            throw new Error(
                `Could not navigate to judging project ${projectName}; current=${currentName}; ` +
                    `progress=${progress}`,
            );
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
    test.setTimeout(240_000);
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
        markProgress("configuring the season and reusable rubric");
        await loginAs(admin.page, "admin@e2e.basishacks.invalid", "/developers/season");
        await expect(
            admin.page.getByRole("heading", { name: "Hackathon Configuration" }),
        ).toBeVisible();
        markProgress("checking the administrator layout at all required widths");
        await expectResponsivePage(admin.page);

        markProgress("configuring season-specific judge comment guidance and prompts");
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
        await createAndSubmitProject(participant.page, participantTeam, participantProject, true);

        markProgress("creating the judge project");
        await loginAs(judge.page, "judge@e2e.basishacks.invalid", "/dashboard/teams");
        await createAndSubmitProject(judge.page, judgeTeam, judgeProject);

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
            participant.page.getByText("You have voted already. Thank you!"),
        ).toBeVisible();

        await judge.page.goto("/judging");
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
        await expect(judge.page.getByRole("button", { name: "Next project" })).toBeEnabled();
        await expectResponsivePage(judge.page);

        await expect(judge.page.getByText(customGuideline, { exact: true })).toBeVisible();
        const firstPrompt = judge.page.getByRole("button", { name: "Evidence + next step" });
        markProgress("saving and restoring the judge draft");
        await expectTouchTarget(firstPrompt);
        await expect(firstPrompt).toBeEnabled();
        await pressWithKeyboard(judge.page, firstPrompt);
        const commentInput = judge.page.getByLabel("Anonymous feedback and score rationale");
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
        await expect(judge.page.getByLabel("Anonymous feedback and score rationale")).toHaveValue(
            comment,
        );
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

        await pressWithKeyboard(
            judge.page,
            judge.page.getByRole("button", { name: "Review evaluation" }),
        );
        markProgress("finalizing the administrator evaluation");
        await expect(
            judge.page.getByRole("heading", { name: "Review before you finalize" }),
        ).toBeVisible();
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
            judge.page.getByLabel("Anonymous feedback and score rationale"),
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
        await expect(
            judge.page.getByRole("heading", { level: 2, name: participantProject }),
        ).toBeVisible();

        markProgress("finalizing the participant evaluation");
        const participantComment =
            "The helpful onboarding flow makes the main task easy to understand. Add one example so new users can get started faster.";
        const participantCommentInput = judge.page.getByLabel(
            "Anonymous feedback and score rationale",
        );
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
                (entry) => Object.keys(entry).join() === "reasoning",
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

        await admin.page.goto("/developers/teams");
        markProgress("checking the administrator feedback view");
        await admin.page.getByPlaceholder("Filter names...").fill(participantTeam);
        const participantRow = admin.page.getByRole("row").filter({ hasText: participantTeam });
        await participantRow.getByRole("button", { name: "View", exact: true }).click();
        const feedbackDialog = admin.page.getByRole("dialog");
        await expect(feedbackDialog.getByText(participantComment, { exact: true })).toBeVisible();
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
            await expect(feedbackDialog.getByText(judgeName, { exact: false })).toBeVisible();
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
