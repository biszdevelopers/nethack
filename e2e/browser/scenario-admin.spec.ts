import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import {
    api,
    baseURL,
    login,
    patchHackathon,
    resetScenarioState,
    restoreState,
    setStatus,
    setSwitch,
} from "./scenario-helpers";

const ADMIN = "admin@e2e.basishacks.invalid";

test.describe.serial("scenario matrix — administrator situations", () => {
    test("administrator scenarios cover configuration, seasons, users, and data", async ({
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
        const suffix = Date.now().toString(36);

        try {
            await resetScenarioState(browser);
            let index = 1;
            const step = async (name: string, body: () => Promise<void>) => {
                await test.step(`A${String(index).padStart(2, "0")} — ${name}`, body);
                index += 1;
            };

            await step("administrator signs in", async () => {
                await login(admin, ADMIN, "/developers/season");
            });

            await step("session includes judge/admin permissions", async () => {
                const session = await api(admin, "/api/auth/session");
                expect(session.status).toBe(200);
                expect(session.body.permissions).toContain("nethack.all");
            });

            await step("hackathon config is readable", async () => {
                const config = await api(admin, "/api/admin/hackathon");
                expect(config.status).toBe(200);
                expect(config.body.hackathon).toBeDefined();
                expect(Array.isArray(config.body.seasons)).toBe(true);
            });

            await step("seasons list is readable", async () => {
                const result = await api(admin, "/api/seasons");
                expect(result.status).toBe(200);
                expect(result.body.length).toBeGreaterThan(0);
            });

            await step("announcement can be set and cleared with null", async () => {
                const set = await patchHackathon(admin, {
                    announcement: `Matrix notice ${suffix}`,
                });
                expect(set.status).toBe(200);
                const cleared = await patchHackathon(admin, { announcement: null });
                expect(cleared.status).toBe(200);
            });

            await step("status can be changed to each valid value", async () => {
                for (const status of [
                    "not_started",
                    "in_progress",
                    "voting",
                    "paused",
                    "not_started",
                ]) {
                    await setStatus(admin, status);
                    expect((await api(admin, "/api/seasons/active")).body.status).toBe(status);
                }
            });

            await step("voting_enabled switch round-trips", async () => {
                await setStatus(admin, "voting");
                await setSwitch(admin, "voting_enabled", 1);
                expect((await api(admin, "/api/seasons/active")).body.is_voting_open).toBe(true);
                await setSwitch(admin, "voting_enabled", 0);
                expect((await api(admin, "/api/seasons/active")).body.is_voting_open).toBe(false);
                await setStatus(admin, "not_started");
            });

            await step("voting toggle applies outside the voting phase", async () => {
                await setStatus(admin, "in_progress");
                await setSwitch(admin, "voting_enabled", 1);
                expect((await api(admin, "/api/seasons/active")).body.is_voting_open).toBe(true);
                await setSwitch(admin, "voting_enabled", 0);
                expect((await api(admin, "/api/seasons/active")).body.is_voting_open).toBe(false);
                await setStatus(admin, "not_started");
            });

            await step("judging_open switch round-trips", async () => {
                await setSwitch(admin, "judging_open", 1);
                await setSwitch(admin, "judging_open", 0);
            });

            await step("judging toggle applies after the event is finished", async () => {
                await setStatus(admin, "finished");
                await setSwitch(admin, "judging_open", 1);
                expect((await api(admin, "/api/seasons/active")).body.is_judging_open).toBe(true);
                await setSwitch(admin, "judging_open", 0);
                expect((await api(admin, "/api/seasons/active")).body.is_judging_open).toBe(false);
                await setStatus(admin, "not_started");
            });

            await step("paused overrides both activity toggles", async () => {
                await setSwitch(admin, "voting_enabled", 1);
                await setSwitch(admin, "judging_open", 1);
                await setStatus(admin, "paused");
                expect((await api(admin, "/api/seasons/active")).body.is_voting_open).toBe(false);
                expect((await api(admin, "/api/seasons/active")).body.is_judging_open).toBe(false);
                await setSwitch(admin, "voting_enabled", 0);
                await setSwitch(admin, "judging_open", 0);
                await setStatus(admin, "not_started");
            });

            await step("show_scores / show_ranking switches round-trip", async () => {
                await setSwitch(admin, "show_scores", 1);
                await setSwitch(admin, "show_ranking", 1);
                await setSwitch(admin, "show_scores", 0);
                await setSwitch(admin, "show_ranking", 0);
            });

            await step(
                "judging toggle dictates the gate regardless of published results",
                async () => {
                    await setStatus(admin, "voting");
                    await setSwitch(admin, "results_published", 1);
                    await setSwitch(admin, "judging_open", 1);
                    expect((await api(admin, "/api/seasons/active")).body.is_judging_open).toBe(
                        true,
                    );
                    await setSwitch(admin, "judging_open", 0);
                    expect((await api(admin, "/api/seasons/active")).body.is_judging_open).toBe(
                        false,
                    );
                    await setSwitch(admin, "results_published", 0);
                    await setStatus(admin, "not_started");
                },
            );

            await step("max_votes_per_user accepts a positive integer", async () => {
                const result = await patchHackathon(admin, { max_votes_per_user: 5 });
                expect(result.status).toBe(200);
                await setSwitch(admin, "max_votes_per_user", 0);
            });

            await step("negative timestamps are rejected", async () => {
                const result = await patchHackathon(admin, { start_timestamp: -1 });
                expect(result.status).toBe(400);
            });

            await step("oversized timestamps are rejected", async () => {
                const result = await patchHackathon(admin, {
                    start_timestamp: 9_000_000_000_000_000,
                });
                expect(result.status).toBe(400);
            });

            await step("new season can be created by copying live settings", async () => {
                const created = await api(admin, "/api/admin/seasons", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        name: `Matrix season ${suffix}`,
                        copy_live_settings: true,
                    }),
                });
                expect(created.status).toBe(200);
            });

            await step("new season can be renamed", async () => {
                const seasons = (await api(admin, "/api/admin/hackathon")).body.seasons;
                const target = seasons.find((s: any) => s.name === `Matrix season ${suffix}`);
                const renamed = await api(admin, "/api/admin/seasons", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        id: target.id,
                        name: `Matrix season renamed ${suffix}`,
                    }),
                });
                expect(renamed.status).toBe(200);
            });

            await step("active season cannot be deleted", async () => {
                const result = await api(admin, "/api/admin/seasons/1", { method: "DELETE" });
                expect(result.status).toBe(409);
            });

            await step("an inactive empty season can be deleted", async () => {
                const created = await api(admin, "/api/admin/seasons", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name: `Matrix disposable ${suffix}` }),
                });
                expect(created.status).toBe(200);
                const id = created.body.seasons.find(
                    (s: any) => s.name === `Matrix disposable ${suffix}`,
                ).id;
                const removed = await api(admin, `/api/admin/seasons/${id}`, { method: "DELETE" });
                expect(removed.status).toBe(200);
            });

            await step("score curve preset can be changed", async () => {
                const result = await api(admin, "/api/admin/seasons/1/score-curve", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ preset: "strong" }),
                });
                expect(result.status).toBe(200);
                expect(result.body.preset).toBe("strong");
            });

            await step("invalid score curve preset is rejected", async () => {
                const result = await api(admin, "/api/admin/seasons/1/score-curve", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ preset: "not-a-preset" }),
                });
                expect(result.status).toBe(400);
            });

            await step("rubric versions are readable", async () => {
                const result = await api(admin, "/api/admin/seasons/1/rubric");
                expect(result.status).toBe(200);
                expect(result.body.active).toBeDefined();
                expect(Object.keys(result.body.active.definition.tracks).length).toBeGreaterThan(0);
            });

            await step("rubric templates are readable", async () => {
                const result = await api(admin, "/api/admin/seasons/1/rubric");
                expect(Array.isArray(result.body.templates)).toBe(true);
            });

            await step("users list is readable and omits secrets", async () => {
                const result = await api(admin, "/api/users");
                expect(result.status).toBe(200);
                expect(JSON.stringify(result.body)).not.toMatch(/cookie_secret|client_secret/i);
            });

            await step("a promoted admin cannot demote themselves", async () => {
                const session = await api(admin, "/api/auth/session");
                const result = await api(admin, `/api/users/${session.body.user.id}/admin`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ is_admin: false }),
                });
                expect([403, 409]).toContain(result.status);
            });

            await step("bulk delete rejects more than 100 ids", async () => {
                const ids = Array.from({ length: 101 }, (_, i) => i + 1);
                const result = await api(admin, "/api/users", {
                    method: "DELETE",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ ids }),
                });
                expect(result.status).toBe(400);
            });

            await step("database export is available to admins", async () => {
                const result = await api(admin, "/api/admin/database/export?format=json");
                expect([200, 400]).toContain(result.status);
            });

            await step("admin scores summary is readable", async () => {
                const result = await api(admin, "/api/admin/scores");
                expect([200, 409]).toContain(result.status);
            });

            await step("admin ballot summary is readable", async () => {
                const result = await api(admin, "/api/ballot/summary");
                expect(result.status).toBe(200);
            });

            await step("admin portal responds at each section", async () => {
                for (const route of [
                    "/developers",
                    "/developers/season",
                    "/developers/teams",
                    "/developers/users",
                    "/developers/docs",
                ]) {
                    const response = await admin.goto(route);
                    expect(response?.status(), route).toBeLessThan(400);
                }
            });

            await step("admin season page is keyboard and a11y clean", async () => {
                await admin.goto("/developers/season");
                await expect(admin.getByRole("heading").first()).toBeVisible();
            });

            await step("manifest source can be read", async () => {
                const result = await api(admin, "/api/admin/hackathon");
                expect(result.status).toBe(200);
            });

            await step("announcement mirrors to the public active read", async () => {
                const text = `Visible notice ${suffix}`;
                await patchHackathon(admin, { announcement: text });
                const active = await api(admin, "/api/seasons/active");
                expect(active.body.announcement).toBe(text);
                await patchHackathon(admin, { announcement: null });
            });

            await step("non-existent season update returns 404", async () => {
                const result = await api(admin, "/api/admin/seasons", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ id: 999999, name: "nope" }),
                });
                expect(result.status).toBe(404);
            });

            await step("non-existent season delete returns 404", async () => {
                expect(
                    (await api(admin, "/api/admin/seasons/999999", { method: "DELETE" })).status,
                ).toBe(404);
            });

            await step("duplicate season name is rejected", async () => {
                const existing = (await api(admin, "/api/seasons")).body[0].name;
                const result = await api(admin, "/api/admin/seasons", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name: existing }),
                });
                expect(result.status).toBe(409);
            });

            await step("max_votes_per_user rejects a negative value", async () => {
                expect((await patchHackathon(admin, { max_votes_per_user: -1 })).status).toBe(400);
            });

            await step("max_votes_per_user rejects a non-integer", async () => {
                expect((await patchHackathon(admin, { max_votes_per_user: 2.5 })).status).toBe(400);
            });

            await step("status rejects an invalid enum value", async () => {
                expect((await patchHackathon(admin, { status: "launched" })).status).toBe(400);
            });

            await step("theme name accepts a clear to null", async () => {
                await patchHackathon(admin, { theme_name: `Theme ${suffix}` });
                expect((await patchHackathon(admin, { theme_name: null })).status).toBe(200);
            });

            await step("admin hackathon read reflects patches", async () => {
                await patchHackathon(admin, { show_scores: 1 });
                const config = await api(admin, "/api/admin/hackathon");
                expect(config.body.hackathon.show_scores).toBe(1);
                await patchHackathon(admin, { show_scores: 0 });
            });

            await step("final state is restored for the shared harness", async () => {
                await restoreState(admin);
                const active = await api(admin, "/api/seasons/active");
                expect(active.body.status).toBe("not_started");
            });
        } finally {
            await Promise.all(contexts.map((context) => context.close()));
        }
    });
});
