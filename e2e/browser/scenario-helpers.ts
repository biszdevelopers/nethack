import { expect, type Page } from "@playwright/test";

export const baseURL = process.env.PLAYWRIGHT_BASE_URL;
if (!baseURL) throw new Error("Set PLAYWRIGHT_BASE_URL in .env for the browser tests.");

export interface ApiResult {
    status: number;
    body: any;
}

/** Call an API through the browser's fetch so cookies + same-origin CSRF headers are attached. */
export async function api(page: Page, path: string, init?: RequestInit): Promise<ApiResult> {
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

export async function login(page: Page, email: string, redirect = "/"): Promise<void> {
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

export async function sessionUser(page: Page): Promise<number> {
    const result = await api(page, "/api/auth/session");
    expect(result.status).toBe(200);
    return result.body.user.id;
}

export async function patchHackathon(
    page: Page,
    body: Record<string, unknown>,
): Promise<ApiResult> {
    return api(page, "/api/admin/hackathon", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

export async function setSwitch(page: Page, key: string, value: number): Promise<void> {
    const result = await patchHackathon(page, { [key]: value });
    expect(result.status, `${key}: ${JSON.stringify(result.body)}`).toBe(200);
}

export async function setStatus(page: Page, status: string): Promise<void> {
    const result = await patchHackathon(page, { status });
    expect(result.status, `status: ${JSON.stringify(result.body)}`).toBe(200);
}

export async function createTeam(page: Page, name: string): Promise<number> {
    const created = await api(page, "/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
    });
    expect(created.status, `team: ${JSON.stringify(created.body)}`).toBe(200);
    return created.body.id;
}

export async function submitProject(
    page: Page,
    teamId: number,
    projectName: string,
): Promise<void> {
    const result = await api(page, `/api/teams/${teamId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            pathway: "junior",
            project: {
                name: projectName,
                description: `${projectName} is an E2E scenario fixture with a clear purpose.`,
                demo_url: `https://example.invalid/${encodeURIComponent(projectName)}`,
                repo_url: `https://github.com/e2e-fixtures/${encodeURIComponent(projectName)}`,
                sourcing: "Original work created for the scenario matrix.",
            },
        }),
    });
    expect(result.status, `submit: ${JSON.stringify(result.body)}`).toBe(200);
}

export async function makeSubmittedTeam(
    page: Page,
    teamName: string,
    projectName: string,
): Promise<number> {
    const id = await createTeam(page, teamName);
    await submitProject(page, id, projectName);
    return id;
}

export async function rubricVersionId(page: Page): Promise<number> {
    const rubric = await api(page, "/api/judging/rubric");
    expect(rubric.status).toBe(200);
    return rubric.body.version_id;
}

export async function scoreTeam(
    page: Page,
    teamId: number,
    versionId: number,
    value: number,
): Promise<void> {
    const rubric = await api(page, "/api/judging/rubric");
    const scores: Record<string, number> = {};
    for (const criterion of rubric.body.tracks.junior.criteria) {
        scores[criterion.id] = Math.min(value, criterion.maxScore);
    }
    const result = await api(page, `/api/teams/${teamId}/scores`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            reasoning: `Scenario evaluation with an observable next step. Score ${value} assigned for this project.`,
            scores,
            rubric_version_id: versionId,
        }),
    });
    expect(result.status, `score: ${JSON.stringify(result.body)}`).toBe(200);
}

export async function restoreState(page: Page): Promise<void> {
    await patchHackathon(page, {
        status: "not_started",
        voting_enabled: 0,
        judging_open: 0,
        results_published: 0,
        show_scores: 0,
        show_ranking: 0,
    });
    await api(page, "/api/admin/seasons", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: 1, is_active: 1 }),
    });
}
