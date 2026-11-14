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
        }
    } finally {
        if (originalViewport) await page.setViewportSize(originalViewport);
    }
}

async function expectTouchTarget(target: Locator) {
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
    await expectTouchTarget(checkbox.locator("xpath=ancestor::label[1]"));
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
    await createButton.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL((url) => url.pathname === "/dashboard");

    await page.goto("/dashboard/general");
    const nameInput = page.getByLabel("Project name");
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
        const option = group.getByText(value, { exact: true });
        if (index === 0) await expectTouchTarget(option.locator("xpath=.."));
        await option.click();
    }
}

async function getTeamIdByProject(page: Page, projectName: string): Promise<number> {
    const teams = await page.evaluate(async () => {
        const response = await fetch("/api/teams?season_id=1");
        if (!response.ok) throw new Error(`Could not load season teams: ${response.status}`);
        return (await response.json()) as {
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

async function navigateToProject(page: Page, projectName: string) {
    const currentProject = page.getByRole("heading", { level: 2 });
    for (let visited = 0; visited < 100; visited += 1) {
        if ((await currentProject.textContent())?.trim() === projectName) return;

        const nextProject = page.getByRole("button", { name: "Next project" });
        if (!(await nextProject.isEnabled())) {
            throw new Error(`Could not navigate to the judging project ${projectName}.`);
        }
        const previousName = (await currentProject.textContent())?.trim();
        await nextProject.click();
        await expect
            .poll(async () => (await currentProject.textContent())?.trim())
            .not.toBe(previousName);
    }

    throw new Error(`Could not find ${projectName} in the first 100 judging projects.`);
}

test("participant, judge, and admin can complete the published scoring journey on mobile", async ({
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
        await expectResponsivePage(admin.page);

        const templateName = `E2E rubric template ${suffix}`;
        await admin.page
            .getByPlaceholder("For example, Project showcase rubric")
            .fill(templateName);
        const templateSave = apiResponse(admin.page, "/api/admin/rubric-templates", "POST");
        await admin.page.getByRole("button", { name: "Save as new template" }).click();
        expect((await templateSave).ok()).toBeTruthy();
        await expect(admin.page.getByText("Reusable template saved.")).toBeVisible();

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
        await judge.page.getByRole("button", { name: /Continue judging/ }).click();
        await expect(judge.page).toHaveURL((url) => url.pathname === "/judging/continue");
        await expect(judge.page.getByRole("heading", { name: "Judge projects" })).toBeVisible();
        markProgress("finding the administrator project in the judge queue");
        await navigateToProject(judge.page, adminProject);
        await expect(judge.page.getByRole("button", { name: "Next project" })).toBeEnabled();
        await expectResponsivePage(judge.page);

        const firstPrompt = judge.page.getByRole("button", { name: "Strength + next step" });
        markProgress("saving and restoring the judge draft");
        await expectTouchTarget(firstPrompt);
        await firstPrompt.click();
        const commentInput = judge.page.getByLabel("Anonymous feedback and score rationale");
        await expect(commentInput).toHaveValue(/Strength I observed/);
        await commentInput.fill(comment);
        await setJudgeScores(judge.page, "3");
        await expect(judge.page.getByRole("button", { name: "Review evaluation" })).toBeEnabled();
        await expect(judge.page.getByText(/Draft saved/)).toBeVisible();

        await judge.page.reload();
        await expect(judge.page.getByRole("heading", { name: "Judge projects" })).toBeVisible();
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

        await judge.page.getByRole("button", { name: "Next project" }).click();
        await expect(judge.page.getByRole("heading", { name: participantProject })).toBeVisible();
        await judge.page.getByRole("button", { name: "Previous project" }).click();
        await expect(judge.page.getByRole("heading", { name: adminProject })).toBeVisible();
        await expect(commentInput).toHaveValue(comment);

        await judge.page.getByRole("button", { name: "Review evaluation" }).click();
        markProgress("finalizing the administrator evaluation");
        await expect(
            judge.page.getByRole("heading", { name: "Review before you finalize" }),
        ).toBeVisible();
        await expect(judge.page.getByText(/your identity will not be shown/i)).toBeVisible();
        await expectResponsivePage(judge.page);
        const firstEvaluation = scoreSubmission(judge.page, adminTeamId);
        await judge.page.getByRole("button", { name: "Finalize evaluation" }).click();
        expect((await firstEvaluation).ok()).toBeTruthy();

        markProgress("finalizing the participant evaluation");
        await navigateToProject(judge.page, participantProject);
        const participantComment =
            "The helpful onboarding flow makes the main task easy to understand. Add one example so new users can get started faster.";
        const participantCommentInput = judge.page.getByLabel(
            "Anonymous feedback and score rationale",
        );
        await participantCommentInput.fill(participantComment);
        await setJudgeScores(judge.page, "4");
        await expect(judge.page.getByRole("button", { name: "Review evaluation" })).toBeEnabled();
        await judge.page.getByRole("button", { name: "Review evaluation" }).click();
        await expect(
            judge.page.getByRole("heading", { name: "Review before you finalize" }),
        ).toBeVisible();
        const secondEvaluation = scoreSubmission(judge.page, participantTeamId);
        await judge.page.getByRole("button", { name: "Finalize evaluation" }).click();
        expect((await secondEvaluation).ok()).toBeTruthy();

        await participant.page.goto("/dashboard/results");
        await expect(participant.page.getByText(participantComment, { exact: true })).toHaveCount(
            0,
        );
        await expect(participant.page.getByText("Judge feedback", { exact: true })).toHaveCount(0);

        await admin.page.goto("/developers/season");
        markProgress("publishing results and checking competitor feedback");
        await setSeasonStatus(admin.page, "Finished");
        await setSeasonCheckbox(admin.page, "Results Published", true);
        await setSeasonCheckbox(admin.page, "Show Scores", true);
        await setSeasonCheckbox(admin.page, "Show Ranking", true);

        await participant.page.goto("/dashboard/results");
        await expect(participant.page.getByText("Original average:")).toContainText("80/100");
        await expect(participant.page.getByText(/Curved display \(Strong uplift\):/)).toContainText(
            "86/100",
        );
        await expect(participant.page.getByText(participantComment, { exact: true })).toBeVisible();
        await expect(
            participant.page.getByText("Anonymous evaluation", { exact: true }),
        ).toBeVisible();
        await expect(
            participant.page.getByText("Judge names and account IDs are hidden."),
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
        await expect(feedbackDialog.getByText("Original average:")).toContainText("80/100");
        await expect(feedbackDialog.getByText(/Curved display \(Strong uplift\):/)).toContainText(
            "86/100",
        );
        await expect(
            feedbackDialog.getByText("Judge names and account IDs are hidden."),
        ).toBeVisible();
        await expect(feedbackDialog.getByText("Judge Fixture", { exact: false })).toHaveCount(0);
        await expect(
            feedbackDialog.getByText("judge@e2e.basishacks.invalid", { exact: false }),
        ).toHaveCount(0);
        await expectResponsivePage(admin.page);
    } finally {
        console.info(`[role-journey] cleanup after ${progress}`);
        await Promise.all([
            admin.context.close(),
            participant.context.close(),
            judge.context.close(),
        ]);
    }
});
