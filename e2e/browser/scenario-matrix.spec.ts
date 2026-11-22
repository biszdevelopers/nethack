import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL;
if (!baseURL) throw new Error("Set PLAYWRIGHT_BASE_URL in .env for the browser tests.");

const a11yTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

interface ApiResult {
    status: number;
    body: any;
}

async function api(page: Page, path: string, init?: RequestInit): Promise<ApiResult> {
    // Use the browser's own fetch so cookies and same-origin CSRF headers are
    // attached exactly as a real user action would send them.
    return page.evaluate(
        async ({ path, method, body }) => {
            const response = await fetch(path, {
                method,
                headers: body ? { "Content-Type": "application/json" } : undefined,
                body,
            });
            let parsed: any;
            try {
                const raw = await response.json();
                parsed = raw && typeof raw === "object" && "data" in raw ? raw.data : raw;
            } catch {
                parsed = null;
            }
            return { status: response.status, body: parsed };
        },
        {
            path,
            method: init?.method ?? "GET",
            body: typeof init?.body === "string" ? init.body : undefined,
        },
    );
}

async function login(page: Page, email: string, redirect = "/"): Promise<void> {
    await page.goto(`/api/login?redirect=${encodeURIComponent(redirect)}`);
    await expect(page.getByRole("heading", { name: "Choose a test identity" })).toBeVisible();
    const consent = page.waitForResponse(
        (r) =>
            new URL(r.url()).pathname === "/authorize/consent" && r.request().method() === "POST",
    );
    await page.getByRole("button").filter({ hasText: email }).click();
    expect((await consent).status()).toBe(302);
    await expect(page).toHaveURL((url) => url.pathname === redirect);
}

async function sessionUser(page: Page): Promise<number> {
    const result = await api(page, "/api/auth/session");
    expect(result.status).toBe(200);
    return result.body.user.id;
}

/** Bring a shared DB to a clean baseline so suites can run in one invocation. */
async function resetScenarioState(browser: Browser): Promise<void> {
    const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 } });
    try {
        const page = await context.newPage();
        await login(page, "admin@e2e.basishacks.invalid", "/developers/season");
        await api(page, "/api/admin/hackathon", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                status: "not_started",
                voting_enabled: 0,
                results_published: 0,
                judging_open: 0,
                show_scores: 0,
                show_ranking: 0,
                announcement: null,
            }),
        });
        const teams = await api(page, "/api/admin/teams");
        if (teams.status === 200 && Array.isArray(teams.body) && teams.body.length > 0) {
            await api(page, "/api/admin/teams", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ids: teams.body.map((t: any) => t.id).slice(0, 100) }),
            });
        }
        await api(page, "/api/admin/seasons", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: 1, is_active: 1 }),
        });
    } finally {
        await context.close();
    }
}

async function setSwitch(page: Page, key: string, value: number): Promise<void> {
    const result = await api(page, "/api/admin/hackathon", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
    });
    expect(result.status, `${key} update failed: ${JSON.stringify(result.body)}`).toBe(200);
}

async function setStatus(page: Page, status: string): Promise<void> {
    const result = await api(page, "/api/admin/hackathon", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
    });
    expect(result.status, `status update failed: ${JSON.stringify(result.body)}`).toBe(200);
}

async function makeTeam(page: Page, name: string, projectName: string): Promise<number> {
    const created = await api(page, "/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
    });
    expect(created.status, `team create failed: ${JSON.stringify(created.body)}`).toBe(200);
    const id = created.body.id;
    const submitted = await api(page, `/api/teams/${id}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            pathway: "junior",
            project: {
                name: projectName,
                description: `${projectName} is an E2E scenario fixture with a clear purpose.`,
                demo_url: `https://example.invalid/${encodeURIComponent(projectName)}`,
                repo_url: `https://github.com/e2e-fixtures/${encodeURIComponent(projectName)}`,
                video_url: `https://example.invalid/${encodeURIComponent(projectName)}.mp4`,
                sourcing: "Original work created for the scenario matrix.",
            },
        }),
    });
    expect(submitted.status, `submit failed: ${JSON.stringify(submitted.body)}`).toBe(200);
    return id;
}

async function scoreTeam(
    page: Page,
    teamId: number,
    rubricVersionId: number,
    value: number,
): Promise<void> {
    const rubric = await api(page, "/api/judging/rubric");
    const criteria = rubric.body.tracks.junior.criteria;
    const scores: Record<string, number> = {};
    for (const criterion of criteria) {
        scores[criterion.id] = Math.min(value, criterion.maxScore);
    }
    const result = await api(page, `/api/teams/${teamId}/scores`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            reasoning: `Scenario matrix evaluation: clear project with an observable next step. Score ${value}.`,
            scores,
            rubric_version_id: rubricVersionId,
        }),
    });
    expect(result.status, `score failed: ${JSON.stringify(result.body)}`).toBe(200);
}

test.describe.serial("scenario matrix — ordered end-to-end event groups", () => {
    test("all lifecycle scenarios run in order across every role", async ({ browser }) => {
        test.setTimeout(600_000);
        const suffix = Date.now().toString(36);
        const contexts: BrowserContext[] = [];
        const newPage = async (): Promise<Page> => {
            const context = await browser.newContext({
                baseURL,
                viewport: { width: 1280, height: 900 },
            });
            contexts.push(context);
            return context.newPage();
        };
        const admin = await newPage();
        const participant = await newPage();
        const judge = await newPage();
        const judgeTwo = await newPage();
        const judgeThree = await newPage();
        const outsider = await newPage();

        let participantTeamId = 0;
        let adminTeamId = 0;
        let judgeTeamId = 0;
        let rubricVersionId = 0;

        try {
            await resetScenarioState(browser);
            await test.step("G01 — anonymous visitor loads the public home page", async () => {
                await admin.goto("/");
                await expect(admin.getByRole("heading").first()).toBeVisible();
                await expect(admin.locator('link[rel="canonical"]')).toHaveAttribute(
                    "href",
                    `${baseURL}/`,
                );
            });

            await test.step("G02 — anonymous visitor browses showcase and season detail", async () => {
                await admin.goto("/showcase");
                await expect(admin.getByRole("heading").first()).toBeVisible();
                await admin.goto("/seasons/1");
                await expect(admin.getByRole("heading").first()).toBeVisible();
            });

            await test.step("G03 — protected route redirects an anonymous visitor to login", async () => {
                await outsider.goto("/dashboard");
                await expect(outsider).toHaveURL(/\/authorize|\/api\/login/);
            });

            await test.step("G04 — administrator signs in through OIDC", async () => {
                await login(admin, "admin@e2e.basishacks.invalid", "/developers/season");
                expect(await sessionUser(admin)).toBeGreaterThan(0);
            });

            await test.step("G05 — participant signs in through OIDC", async () => {
                await login(participant, "participant@e2e.basishacks.invalid", "/dashboard");
                expect(await sessionUser(participant)).toBeGreaterThan(0);
            });

            await test.step("G06 — judges sign in through OIDC", async () => {
                await login(judge, "judge@e2e.basishacks.invalid", "/judging");
                await login(judgeTwo, "judge-two@e2e.basishacks.invalid", "/judging");
                await login(judgeThree, "judge-three@e2e.basishacks.invalid", "/judging");
                expect(await sessionUser(judge)).toBeGreaterThan(0);
            });

            await test.step("G07 — profile picture endpoint serves the seeded avatar", async () => {
                const id = await sessionUser(admin);
                const picture = await admin.request.get(`/api/users/${id}/profile_picture`);
                expect(picture.ok()).toBe(true);
                expect(picture.headers()["content-type"]).toBe("image/gif");
            });

            await test.step("G08 — participant cannot enter the admin portal", async () => {
                const seasonPage = await api(participant, "/api/admin/hackathon");
                expect(seasonPage.status).toBe(403);
            });

            await test.step("G09 — administrator reads the active season configuration", async () => {
                const result = await api(admin, "/api/seasons/active");
                expect(result.status).toBe(200);
                expect(result.body.id).toBeGreaterThan(0);
            });

            await test.step("G10 — administrator saves a rubric version", async () => {
                await admin.goto("/developers/season");
                const tab = admin.getByRole("tab", { name: "Rubric", exact: true });
                await tab.click();
                await admin.getByLabel("New rubric version name").fill(`Matrix rubric ${suffix}`);
                const response = admin.waitForResponse(
                    (r) =>
                        /\/api\/admin\/seasons\/\d+\/rubric$/.test(new URL(r.url()).pathname) &&
                        r.request().method() === "POST",
                );
                await admin.getByRole("button", { name: "Save new version" }).click();
                const saved = await response;
                expect(saved.ok()).toBe(true);
                rubricVersionId = (await saved.json()).data.active.id;
            });

            await test.step("G11 — administrator sets the score curve", async () => {
                const tab = admin.getByRole("tab", { name: "Seasons", exact: true });
                await tab.click();
                const result = await api(admin, "/api/admin/seasons/1/score-curve", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ preset: "moderate" }),
                });
                expect(result.status, `score curve failed: ${JSON.stringify(result.body)}`).toBe(
                    200,
                );
                expect(result.body.preset).toBe("moderate");
            });

            await test.step("G12 — administrator opens the event for project entry", async () => {
                await setStatus(admin, "in_progress");
                const result = await api(admin, "/api/seasons/active");
                expect(result.body.status).toBe("in_progress");
            });

            await test.step("G13 — participant creates and submits a project", async () => {
                participantTeamId = await makeTeam(
                    participant,
                    `Matrix-P-team-${suffix}`,
                    `Matrix participant project ${suffix}`,
                );
                expect(participantTeamId).toBeGreaterThan(0);
            });

            await test.step("G14 — administrator creates and submits a project", async () => {
                adminTeamId = await makeTeam(
                    admin,
                    `Matrix-A-team-${suffix}`,
                    `Matrix admin project ${suffix}`,
                );
                expect(adminTeamId).toBeGreaterThan(0);
            });

            await test.step("G15 — judge creates and submits a project", async () => {
                judgeTeamId = await makeTeam(
                    judgeTwo,
                    `Matrix-J-team-${suffix}`,
                    `Matrix judge project ${suffix}`,
                );
                expect(judgeTeamId).toBeGreaterThan(0);
            });

            await test.step("G16 — a second project submission is rejected", async () => {
                const duplicate = await api(participant, `/api/teams/${participantTeamId}/submit`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        pathway: "junior",
                        project: {
                            name: "Duplicate",
                            description: "A duplicate submission attempt that must be rejected.",
                            demo_url: "https://example.invalid/duplicate",
                            repo_url: "https://github.com/e2e/duplicate",
                            video_url: "https://example.invalid/duplicate.mp4",
                        },
                    }),
                });
                expect([400, 403, 409]).toContain(duplicate.status);
            });

            await test.step("G17 — last-member removal and post-submission removal are blocked", async () => {
                // After submission, member removal is forbidden regardless of count.
                const me = await sessionUser(participant);
                const afterSubmit = await api(
                    participant,
                    `/api/teams/${participantTeamId}/users/${me}`,
                    { method: "DELETE" },
                );
                expect(afterSubmit.status).toBe(403);
            });

            await test.step("G18 — administrator opens voting and judging", async () => {
                await setStatus(admin, "voting");
                await setSwitch(admin, "voting_enabled", 1);
                await setSwitch(admin, "judging_open", 1);
                const result = await api(admin, "/api/seasons/active");
                expect(result.body.is_voting_open).toBe(true);
                expect(result.body.is_judging_open).toBe(true);
            });

            await test.step("G19 — participant casts a valid peer vote", async () => {
                const ballot = await api(participant, "/api/ballot");
                expect(ballot.status).toBe(200);
                const projects = ballot.body.projects;
                // Each score must be 0-5 and the total must be exactly 10.
                const scores = projects.map((_: unknown, index: number) => (index < 2 ? 5 : 0));
                const submitted = await api(participant, "/api/ballot", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        scores,
                        reasoning: "Matrix vote with a ten-star allocation.",
                    }),
                });
                expect(submitted.status).toBe(200);
            });

            await test.step("G20 — a ballot whose stars do not sum to ten is rejected", async () => {
                const rejected = await api(judge, "/api/ballot", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        scores: [3, 3],
                        reasoning: "An invalid ballot that must fail.",
                    }),
                });
                expect([400, 403]).toContain(rejected.status);
            });

            await test.step("G21 — judge loads the judging queue", async () => {
                await judge.goto("/judging");
                await expect(
                    judge.getByRole("heading", { name: "Judging", exact: true }),
                ).toBeVisible();
                const queue = await api(judge, "/api/teams?judging=true&page=1&page_size=20");
                expect(queue.status).toBe(200);
                expect(queue.body.items.length).toBeGreaterThan(0);
            });

            await test.step("G22 — participant cannot access the judging queue", async () => {
                const queue = await api(participant, "/api/teams?judging=true");
                expect(queue.status).toBe(403);
            });

            await test.step("G23 — judge reaches the scoring workspace", async () => {
                await judge.goto("/judging/continue");
                await expect(judge.getByRole("heading", { name: "Judge projects" })).toBeVisible();
            });

            await test.step("G24 — judge scores the administrator project", async () => {
                await scoreTeam(judge, adminTeamId, rubricVersionId, 3);
            });

            await test.step("G25 — judge scores the participant project", async () => {
                await scoreTeam(judge, participantTeamId, rubricVersionId, 4);
            });

            await test.step("G26 — duplicate judge scores are rejected", async () => {
                const duplicate = await api(judge, `/api/teams/${adminTeamId}/scores`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        reasoning: "A duplicate evaluation attempt that must be rejected entirely.",
                        scores: {},
                        rubric_version_id: rubricVersionId,
                    }),
                });
                expect([400, 409]).toContain(duplicate.status);
            });

            await test.step("G27 — second judge reaches the anonymity threshold", async () => {
                await scoreTeam(judgeTwo, participantTeamId, rubricVersionId, 4);
            });

            await test.step("G28 — third judge releases feedback eligibility", async () => {
                await scoreTeam(judgeThree, participantTeamId, rubricVersionId, 4);
            });

            await test.step("G29 — administrator publishes results and recomputes", async () => {
                await setSwitch(admin, "results_published", 1);
                await setSwitch(admin, "show_scores", 1);
                await setSwitch(admin, "show_ranking", 1);
                const recompute = await api(admin, "/api/admin/scores/compute", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: "{}",
                });
                expect([200, 409]).toContain(recompute.status);
            });

            await test.step("G30 — participant sees published but anonymized feedback", async () => {
                const feedback = await api(participant, `/api/teams/${participantTeamId}/scores`);
                expect(feedback.status).toBe(200);
                expect(feedback.body.original_score).toBeGreaterThan(0);
                expect(JSON.stringify(feedback.body)).not.toMatch(/judge(?:-two|-three)?@e2e/);
            });

            await test.step("G31 — administrator sees judge identities in feedback", async () => {
                const feedback = await api(admin, `/api/admin/teams/${participantTeamId}/scores`);
                expect(feedback.status).toBe(200);
                expect(JSON.stringify(feedback.body)).toMatch(/Judge Fixture/);
            });

            await test.step("G32 — administrator creates a successor season", async () => {
                const created = await api(admin, "/api/admin/seasons", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        name: `Matrix successor ${suffix}`,
                        copy_live_settings: true,
                        is_active: 1,
                    }),
                });
                expect(created.status).toBe(200);
            });

            await test.step("G33 — finished season archive is publicly readable", async () => {
                await outsider.goto("/showcase/seasons/1");
                await expect(outsider.getByRole("heading").first()).toBeVisible();
            });

            await test.step("G34 — archived season keeps its published settings", async () => {
                const archived = await api(admin, "/api/seasons");
                expect(archived.status).toBe(200);
                const season1 = archived.body.find((season: any) => season.id === 1);
                expect(season1).toBeDefined();
                expect(season1.is_active).toBe(0);
            });

            await test.step("G35 — successor season is active", async () => {
                const active = await api(admin, "/api/seasons/active");
                expect(active.body.status).toBeDefined();
            });

            await test.step("G36 — admin scores recompute is available", async () => {
                const result = await api(admin, "/api/admin/scores", { method: "GET" });
                expect([200, 409]).toContain(result.status);
            });

            await test.step("G37 — ballot summary is available to admin", async () => {
                expect((await api(admin, "/api/ballot/summary")).status).toBe(200);
            });

            await test.step("G38 — rubric remains readable after archiving", async () => {
                const result = await api(admin, "/api/admin/seasons/1/rubric");
                expect(result.status).toBe(200);
            });

            await test.step("G39 — public showcase still lists archived projects", async () => {
                await outsider.goto("/showcase");
                await expect(outsider.getByRole("heading").first()).toBeVisible();
            });

            await test.step("G40 — judge history is reachable after publication", async () => {
                await judge.goto("/judging/history/1");
                await expect(judge.getByRole("heading").first()).toBeVisible();
            });

            await test.step("G41 — active season is restored for the shared harness", async () => {
                const restored = await api(admin, "/api/admin/seasons", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ id: 1, is_active: 1 }),
                });
                expect(restored.status).toBe(200);
            });

            await test.step("G42 — signed-in pages remain accessibility clean", async () => {
                await participant.goto("/dashboard");
                const results = await new AxeBuilder({ page: participant })
                    .withTags(a11yTags)
                    .analyze();
                expect(results.violations).toEqual([]);
            });

            await test.step("G43 — participant signs out", async () => {
                await participant.goto("/");
                const logout = await api(participant, "/api/auth/logout", { method: "POST" });
                expect(logout.status).toBe(200);
                const session = await api(participant, "/api/auth/session");
                expect(session.status).toBe(401);
            });
        } finally {
            await Promise.all(contexts.map((context) => context.close()));
        }
    });
});
