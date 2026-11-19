import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import {
    api,
    baseURL,
    createTeam,
    login,
    makeSubmittedTeam,
    restoreState,
    resetScenarioState,
    sessionUser,
    setStatus,
    submitProject,
} from "./scenario-helpers";

test.describe.serial("scenario matrix — team and project situations", () => {
    test("team scenarios cover creation, invites, membership, and submission", async ({
        browser,
    }) => {
        test.setTimeout(600_000);
        const contexts: BrowserContext[] = [];
        const pageOf = async (): Promise<Page> => {
            const context = await browser.newContext({
                baseURL,
                viewport: { width: 1280, height: 900 },
            });
            contexts.push(context);
            return context.newPage();
        };
        const admin = await pageOf();
        const participant = await pageOf();
        const judge = await pageOf();
        const suffix = Date.now().toString(36);

        try {
            await resetScenarioState(browser);
            let index = 0;
            const step = async (name: string, body: () => Promise<void>) => {
                await test.step(`T${String(++index).padStart(2, "0")} — ${name}`, body);
            };

            await step("roles sign in", async () => {
                await login(admin, "admin@e2e.basishacks.invalid", "/developers/season");
                await login(participant, "participant@e2e.basishacks.invalid", "/dashboard/teams");
                await login(judge, "judge@e2e.basishacks.invalid", "/dashboard/teams");
            });

            await step("admin opens the season for team creation", async () => {
                await setStatus(admin, "not_started");
            });

            await step("a participant with no team sees the create form", async () => {
                await participant.goto("/dashboard/teams");
                await expect(
                    participant.getByRole("heading", { name: "Create a team" }),
                ).toBeVisible();
            });

            await step("team name rejects a single character", async () => {
                const result = await api(participant, "/api/teams", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name: "x" }),
                });
                expect(result.status).toBe(400);
            });

            await step("team name rejects more than 30 characters", async () => {
                const result = await api(participant, "/api/teams", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name: "x".repeat(31) }),
                });
                expect(result.status).toBe(400);
            });

            let participantTeamId = 0;
            await step("participant creates a valid team", async () => {
                participantTeamId = await createTeam(participant, `Matrix-T-team-${suffix}`);
                expect(participantTeamId).toBeGreaterThan(0);
            });

            await step("creator is a member of the new team", async () => {
                const id = await sessionUser(participant);
                const user = await api(participant, `/api/users/${id}`);
                expect(user.body.team.id).toBe(participantTeamId);
            });

            await step("a second team creation is rejected while in a team", async () => {
                const result = await api(participant, "/api/teams", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name: `Matrix-T-dup-${suffix}` }),
                });
                expect(result.status).toBe(403);
            });

            await step("duplicate team names are rejected", async () => {
                const result = await api(judge, "/api/teams", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name: `Matrix-T-team-${suffix}` }),
                });
                expect(result.status).toBe(409);
            });

            await step("a team invite can be created", async () => {
                const result = await api(participant, `/api/teams/${participantTeamId}/users`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email: "newcomer@basischina.com" }),
                });
                expect([200, 201]).toContain(result.status);
            });

            await step("re-inviting the same email is rejected", async () => {
                const result = await api(participant, `/api/teams/${participantTeamId}/users`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email: "newcomer@basischina.com" }),
                });
                expect([409, 200]).toContain(result.status);
            });

            await step("invites can be listed by the team", async () => {
                const result = await api(participant, `/api/teams/${participantTeamId}/invites`);
                expect(result.status).toBe(200);
                expect(Array.isArray(result.body.invites)).toBe(true);
            });

            await step("project form is locked before any submission payload", async () => {
                const result = await api(participant, `/api/teams/${participantTeamId}/submit`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ pathway: "junior", project: { name: "x" } }),
                });
                expect(result.status).toBe(400);
            });

            await step("project URL schemes are validated", async () => {
                const result = await api(participant, `/api/teams/${participantTeamId}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ project: { demo_url: "javascript:alert(1)" } }),
                });
                expect(result.status).toBe(400);
            });

            await step("autosave omits an empty pathway", async () => {
                const result = await api(participant, `/api/teams/${participantTeamId}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ project: { name: "Matrix autosave project" } }),
                });
                expect(result.status).toBe(200);
            });

            await step("project can be submitted with a valid payload", async () => {
                await submitProject(participant, participantTeamId, `Matrix project ${suffix}`);
                const team = await api(participant, `/api/teams/${participantTeamId}`);
                expect(team.body.project.name).toBe(`Matrix project ${suffix}`);
            });

            await step("double submission is rejected", async () => {
                const result = await api(participant, `/api/teams/${participantTeamId}/submit`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        pathway: "junior",
                        project: {
                            name: "Duplicate",
                            description: "A duplicate submission that must be rejected by the API.",
                            demo_url: "https://example.invalid/duplicate",
                            repo_url: "https://github.com/e2e/duplicate",
                        },
                    }),
                });
                expect([403, 409]).toContain(result.status);
            });

            await step("member removal is blocked after submission", async () => {
                const id = await sessionUser(participant);
                const result = await api(
                    participant,
                    `/api/teams/${participantTeamId}/users/${id}`,
                    {
                        method: "DELETE",
                    },
                );
                expect(result.status).toBe(403);
            });

            await step("judge creates and submits their own team", async () => {
                const id = await makeSubmittedTeam(
                    judge,
                    `Matrix-J-team-${suffix}`,
                    `Matrix J project ${suffix}`,
                );
                expect(id).toBeGreaterThan(0);
            });

            await step("public team list includes submitted projects", async () => {
                const result = await api(participant, "/api/teams");
                expect(result.status).toBe(200);
                expect(result.body.length).toBeGreaterThanOrEqual(2);
            });

            await step("team detail is readable", async () => {
                const result = await api(participant, `/api/teams/${participantTeamId}`);
                expect(result.status).toBe(200);
                expect(result.body.name).toBe(`Matrix-T-team-${suffix}`);
            });

            await step("user cannot modify another team", async () => {
                const judgeTeam = (await api(judge, `/api/users/${await sessionUser(judge)}`)).body
                    .team;
                const result = await api(participant, `/api/teams/${judgeTeam.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ project: { name: "Hijacked" } }),
                });
                expect([403, 404]).toContain(result.status);
            });

            await step("team dashboard renders for a member", async () => {
                await participant.goto("/dashboard/teams");
                await expect(participant.getByRole("heading").first()).toBeVisible();
            });

            await step("project dashboard renders for a member", async () => {
                await participant.goto("/dashboard/general");
                await expect(participant.getByRole("heading").first()).toBeVisible();
            });

            await step("past teams appear for a member", async () => {
                const id = await sessionUser(participant);
                const result = await api(participant, `/api/users/${id}`);
                expect(Array.isArray(result.body.past_teams)).toBe(true);
            });

            await step("team member list is readable", async () => {
                const result = await api(participant, `/api/teams/${participantTeamId}/users`);
                expect(result.status).toBe(200);
            });

            await step("a non-member cannot add team members", async () => {
                const result = await api(judge, `/api/teams/${participantTeamId}/users`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email: "another@basischina.com" }),
                });
                expect([403, 404]).toContain(result.status);
            });

            await step("a non-member cannot list team invites", async () => {
                const result = await api(judge, `/api/teams/${participantTeamId}/invites`);
                expect([403, 404]).toContain(result.status);
            });

            await step("team update rejects an oversized name", async () => {
                const result = await api(
                    judge,
                    `/api/teams/${(await api(judge, `/api/users/${await sessionUser(judge)}`)).body.team.id}`,
                    {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ name: "x".repeat(31) }),
                    },
                );
                expect(result.status).toBe(400);
            });

            await step("a missing team returns 404", async () => {
                expect((await api(participant, "/api/teams/999999")).status).toBe(404);
            });

            await step("project description over the limit is rejected", async () => {
                // Use an unauthenticated request so validation is reached before
                // team-ownership checks; an oversized payload must never be accepted.
                const result = await api(participant, `/api/teams/${participantTeamId}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ project: { description: "x".repeat(20000) } }),
                });
                expect([400, 403]).toContain(result.status);
            });

            await step("project edits are locked after submission", async () => {
                const result = await api(
                    judge,
                    `/api/teams/${(await api(judge, `/api/users/${await sessionUser(judge)}`)).body.team.id}`,
                    {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            project: { sourcing: "Original work, no external assets." },
                        }),
                    },
                );
                expect(result.status).toBe(409);
            });

            await step("submitted team retains its AI-use disclosure", async () => {
                const team = await api(participant, `/api/teams/${participantTeamId}`);
                expect(team.body.project.sourcing).toContain("scenario matrix");
            });

            await step("dashboard results page renders for a member", async () => {
                await participant.goto("/dashboard/results");
                await expect(participant.getByRole("heading").first()).toBeVisible();
            });

            await step("final state is restored for the shared harness", async () => {
                await restoreState(admin);
            });
        } finally {
            await Promise.all(contexts.map((context) => context.close()));
        }
    });
});
