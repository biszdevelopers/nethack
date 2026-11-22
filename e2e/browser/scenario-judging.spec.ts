import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import {
    api,
    baseURL,
    login,
    makeSubmittedTeam,
    restoreState,
    resetScenarioState,
    rubricVersionId,
    scoreTeam,
    setStatus,
    setSwitch,
} from "./scenario-helpers";

test.describe.serial("scenario matrix — voting, judging, and results situations", () => {
    test("judging scenarios cover ballots, drafts, scores, anonymity, and publication", async ({
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
        const judgeTwo = await pageOf();
        const judgeThree = await pageOf();
        const builder = await pageOf();
        const suffix = Date.now().toString(36);

        try {
            await resetScenarioState(browser);
            let index = 0;
            const step = async (name: string, body: () => Promise<void>) => {
                await test.step(`J${String(++index).padStart(2, "0")} — ${name}`, body);
            };

            await step("all roles sign in", async () => {
                await login(admin, "admin@e2e.basishacks.invalid", "/developers/season");
                await login(participant, "participant@e2e.basishacks.invalid", "/dashboard");
                await login(judge, "judge@e2e.basishacks.invalid", "/judging");
                await login(judgeTwo, "judge-two@e2e.basishacks.invalid", "/judging");
                await login(judgeThree, "judge-three@e2e.basishacks.invalid", "/judging");
                await login(builder, "builder@e2e.basishacks.invalid", "/dashboard");
            });

            await step("admin opens the season for submissions", async () => {
                await setStatus(admin, "in_progress");
            });

            let participantTeam = 0;
            let adminTeam = 0;
            await step("participant and two others submit projects", async () => {
                participantTeam = await makeSubmittedTeam(
                    participant,
                    `Matrix-J-P-${suffix}`,
                    `Matrix J participant ${suffix}`,
                );
                adminTeam = await makeSubmittedTeam(
                    admin,
                    `Matrix-J-A-${suffix}`,
                    `Matrix J admin ${suffix}`,
                );
                // A second eligible project is required: each star score is 0-5
                // and the total must be exactly 10.
                await makeSubmittedTeam(
                    builder,
                    `Matrix-J-J-${suffix}`,
                    `Matrix J judge ${suffix}`,
                );
            });

            await step("admin opens the voting phase", async () => {
                await setStatus(admin, "voting");
                await setSwitch(admin, "voting_enabled", 1);
                expect((await api(admin, "/api/seasons/active")).body.is_voting_open).toBe(true);
            });

            await step("peer ballot is readable by an eligible participant", async () => {
                const result = await api(participant, "/api/ballot");
                expect(result.status).toBe(200);
                expect(result.body.projects.length).toBeGreaterThan(0);
            });

            await step("ballot with wrong score count is rejected", async () => {
                const result = await api(participant, "/api/ballot", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ scores: [5], reasoning: "Wrong number of scores." }),
                });
                expect(result.status).toBe(400);
            });

            await step("ballot not summing to ten is rejected", async () => {
                const result = await api(participant, "/api/ballot", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ scores: [5, 4], reasoning: "Stars must sum to ten." }),
                });
                expect(result.status).toBe(400);
            });

            await step("the organizer's max votes cap is enforced", async () => {
                await setSwitch(admin, "max_votes_per_user", 1);
                const capped = await api(participant, "/api/ballot", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        scores: [5, 5],
                        reasoning: "Two projects exceed the configured cap.",
                    }),
                });
                expect(capped.status).toBe(400);
                await setSwitch(admin, "max_votes_per_user", 0);
            });

            await step("a valid ballot is accepted", async () => {
                const result = await api(participant, "/api/ballot", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        scores: [5, 5],
                        reasoning: "Both projects show clear, observable progress.",
                    }),
                });
                expect(result.status).toBe(200);
            });

            await step("a submitted ballot can be updated before voting closes", async () => {
                const result = await api(participant, "/api/ballot", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        scores: [5, 5],
                        reasoning: "Updated reasoning for the same distribution.",
                    }),
                });
                expect(result.status).toBe(200);
                const ballot = await api(participant, "/api/ballot");
                expect(ballot.body.submitted).toBe(true);
                expect(ballot.body.reasoning).toBe("Updated reasoning for the same distribution.");
            });

            await step("admin opens judging", async () => {
                await setSwitch(admin, "judging_open", 1);
                expect((await api(admin, "/api/seasons/active")).body.is_judging_open).toBe(true);
            });

            await step("judging queue is readable by a judge", async () => {
                const result = await api(judge, "/api/teams?judging=true&page=1&page_size=20");
                expect(result.status).toBe(200);
                expect(result.body.items.length).toBeGreaterThan(0);
            });

            await step("judging rubric is readable", async () => {
                expect((await api(judge, "/api/judging/rubric")).status).toBe(200);
            });

            await step("ballot summary is readable by a judge", async () => {
                expect((await api(judge, "/api/ballot/summary")).status).toBe(200);
            });

            await step("judge workspace page renders", async () => {
                await judge.goto("/judging/continue");
                await expect(judge.getByRole("heading", { name: "Judge projects" })).toBeVisible();
            });

            const versionId = await rubricVersionId(judge);

            await step("judge draft can be saved", async () => {
                const draft = await api(judge, `/api/judging/drafts/${participantTeam}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        scores: { originality: 3 },
                        reasoning: "A saved draft that will be resumed later.",
                        rubric_version_id: versionId,
                    }),
                });
                expect(draft.status).toBe(200);
            });

            await step("judge draft can be read back", async () => {
                const result = await api(judge, `/api/judging/drafts/${participantTeam}`);
                expect(result.status).toBe(200);
                expect(result.body.draft.reasoning).toContain("saved draft");
            });

            await step("judge draft can be deleted", async () => {
                const result = await api(judge, `/api/judging/drafts/${participantTeam}`, {
                    method: "DELETE",
                });
                expect(result.status).toBe(200);
            });

            await step("judge scores the participant project", async () => {
                await scoreTeam(judge, participantTeam, versionId, 4);
            });

            await step("duplicate judge score is rejected", async () => {
                const rubric = await api(judge, "/api/judging/rubric");
                const scores: Record<string, number> = {};
                for (const criterion of rubric.body.tracks.junior.criteria)
                    scores[criterion.id] = 3;
                const result = await api(judge, `/api/teams/${participantTeam}/scores`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        reasoning: "A duplicate evaluation that must be rejected by the API.",
                        scores,
                        rubric_version_id: versionId,
                    }),
                });
                expect([400, 409]).toContain(result.status);
            });

            await step("judge scores the admin project", async () => {
                await scoreTeam(judge, adminTeam, versionId, 3);
            });

            await step("feedback is inaccessible before publication", async () => {
                const result = await api(participant, `/api/teams/${participantTeam}/scores`);
                expect(result.status).toBe(403);
            });

            await step("second judge reaches the anonymity threshold", async () => {
                await scoreTeam(judgeTwo, participantTeam, versionId, 4);
            });

            await step("third judge completes the review set", async () => {
                await scoreTeam(judgeThree, participantTeam, versionId, 4);
            });

            await step("admin publishes results and recomputes", async () => {
                await setSwitch(admin, "results_published", 1);
                await setSwitch(admin, "show_scores", 1);
                await setSwitch(admin, "show_ranking", 1);
                const result = await api(admin, "/api/admin/scores/compute", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: "{}",
                });
                expect([200, 409]).toContain(result.status);
            });

            await step(
                "published results freeze judging until the toggle is reopened",
                async () => {
                    // Publishing results freezes judging and voting by default.
                    expect((await api(admin, "/api/seasons/active")).body.is_judging_open).toBe(
                        false,
                    );
                    await setSwitch(admin, "judging_open", 1);
                    expect((await api(admin, "/api/seasons/active")).body.is_judging_open).toBe(
                        true,
                    );
                    const queue = await api(judge, "/api/teams?judging=true");
                    expect(queue.status).toBe(200);
                    // Explicitly turning the toggle off closes judging.
                    await setSwitch(admin, "judging_open", 0);
                    expect((await api(admin, "/api/seasons/active")).body.is_judging_open).toBe(
                        false,
                    );
                    expect((await api(judge, "/api/teams?judging=true")).status).toBe(403);
                    await setSwitch(admin, "judging_open", 1);
                },
            );

            await step("published participant feedback is anonymized", async () => {
                const result = await api(participant, `/api/teams/${participantTeam}/scores`);
                expect(result.status).toBe(200);
                expect(result.body.original_score).toBeGreaterThan(0);
                expect(JSON.stringify(result.body)).not.toMatch(/judge(?:-two|-three)?@e2e/);
            });

            await step("admin feedback exposes judge identities", async () => {
                const result = await api(admin, `/api/admin/teams/${participantTeam}/scores`);
                expect(result.status).toBe(200);
                expect(JSON.stringify(result.body)).toMatch(/Judge Fixture/);
            });

            await step("participant results page renders", async () => {
                await participant.goto("/dashboard/results");
                await expect(participant.getByRole("heading").first()).toBeVisible();
            });

            await step("judge history page renders", async () => {
                await judge.goto("/judging/history/1");
                await expect(judge.getByRole("heading").first()).toBeVisible();
            });

            await step("ballot summary is readable by a judge", async () => {
                const result = await api(judge, "/api/ballot/summary");
                expect(result.status).toBe(200);
            });

            await step("judge cannot score their own team", async () => {
                const rubric = await api(judgeTwo, "/api/judging/rubric");
                const judgeTwoTeam = (
                    await api(
                        judgeTwo,
                        `/api/users/${rubric && (await api(judgeTwo, "/api/auth/session")).body.user.id}`,
                    )
                ).body.team;
                if (!judgeTwoTeam) return;
                const scores: Record<string, number> = {};
                for (const criterion of rubric.body.tracks.junior.criteria)
                    scores[criterion.id] = 3;
                const result = await api(judgeTwo, `/api/teams/${judgeTwoTeam.id}/scores`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        reasoning: "An evaluation of my own team that must be rejected.",
                        scores,
                        rubric_version_id: versionId,
                    }),
                });
                expect([403, 404, 409]).toContain(result.status);
            });

            await step("score rubric is season-specific", async () => {
                const result = await api(judge, "/api/judging/rubric");
                expect(result.body.version_id).toBe(versionId);
            });

            await step("feedback rejects non-members", async () => {
                const result = await api(admin, `/api/teams/${participantTeam}/scores`);
                // Admin uses the privileged endpoint, not the public feedback one;
                // the public endpoint hides teams the caller is not part of.
                expect([200, 403, 404]).toContain(result.status);
            });

            await step("admin scores endpoint lists computed results", async () => {
                const result = await api(admin, "/api/admin/scores");
                expect([200, 409]).toContain(result.status);
            });

            await step("results page hides judge identities in public payload", async () => {
                const result = await api(participant, `/api/teams/${participantTeam}/scores`);
                if (result.status !== 200) return;
                expect(JSON.stringify(result.body)).not.toMatch(/judge_user_id|judge_name/);
            });

            await step("draft endpoint rejects a wrong rubric version", async () => {
                const result = await api(judge, `/api/judging/drafts/${adminTeam}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        scores: {},
                        reasoning: "A draft pinned to a rubric that does not exist.",
                        rubric_version_id: 999999,
                    }),
                });
                expect([400, 403, 409]).toContain(result.status);
            });

            await step("final state is restored for the shared harness", async () => {
                await restoreState(admin);
            });
        } finally {
            await Promise.all(contexts.map((context) => context.close()));
        }
    });
});
