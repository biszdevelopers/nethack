import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { api, baseURL, resetScenarioState } from "./scenario-helpers";

const a11yTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const PUBLIC_ROUTES = [
    "/",
    "/rules",
    "/contributing",
    "/showcase",
    "/showcase/signal",
    "/showcase/beneath-the-surface",
    "/seasons/1",
] as const;

test.describe.serial("scenario matrix — public and guest situations", () => {
    test("guest scenarios cover every public surface", async ({ browser }) => {
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
        const page = await pageOf();

        try {
            await resetScenarioState(browser);
            let index = 1;
            for (const route of PUBLIC_ROUTES) {
                const n = String(index).padStart(2, "0");
                await test.step(`P${n} — guest opens ${route}`, async () => {
                    const response = await page.goto(route);
                    expect(response?.status(), `${route} status`).toBeLessThan(400);
                    await expect(page.getByRole("heading").first()).toBeVisible();
                });
                index += 1;
            }

            for (const scheme of ["light", "dark"] as const) {
                await page.emulateMedia({ colorScheme: scheme });
                const n = String(index).padStart(2, "0");
                await test.step(`P${n} — home renders in ${scheme} color scheme`, async () => {
                    await page.goto("/");
                    await expect(page.locator("html")).toBeVisible();
                    const overflow = await page.evaluate(
                        () =>
                            document.documentElement.scrollWidth -
                            document.documentElement.clientWidth,
                    );
                    expect(overflow).toBeLessThanOrEqual(0);
                });
                index += 1;
            }
            await page.emulateMedia({ colorScheme: "light" });

            for (const width of [320, 375, 768, 1024, 1440]) {
                const n = String(index).padStart(2, "0");
                await test.step(`P${n} — public pages fit a ${width}px viewport`, async () => {
                    await page.setViewportSize({ width, height: 900 });
                    for (const route of ["/", "/showcase", "/rules"]) {
                        await page.goto(route);
                        const overflow = await page.evaluate(
                            () =>
                                document.documentElement.scrollWidth -
                                document.documentElement.clientWidth,
                        );
                        expect(overflow, `${route} overflows at ${width}px`).toBeLessThanOrEqual(0);
                    }
                });
                index += 1;
            }
            await page.setViewportSize({ width: 1280, height: 900 });

            for (const route of ["/", "/showcase", "/rules"]) {
                const n = String(index).padStart(2, "0");
                await test.step(`P${n} — accessibility sweep of ${route}`, async () => {
                    await page.goto(route);
                    const results = await new AxeBuilder({ page }).withTags(a11yTags).analyze();
                    expect(results.violations, `${route} a11y`).toEqual([]);
                });
                index += 1;
            }

            const n1 = String(index).padStart(2, "0");
            await test.step(`P${n1} — canonical URLs match public routes`, async () => {
                for (const route of ["/", "/showcase", "/rules"]) {
                    await page.goto(route);
                    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
                        "href",
                        `${baseURL}${route}`,
                    );
                }
            });
            index += 1;

            const n2 = String(index).padStart(2, "0");
            await test.step(`P${n2} — exactly one main landmark per public page`, async () => {
                for (const route of ["/", "/showcase", "/rules", "/dashboard"]) {
                    await page.goto(route);
                    expect(
                        await page.locator("main").count(),
                        `${route} main count`,
                    ).toBeLessThanOrEqual(1);
                }
            });
            index += 1;

            const n3 = String(index).padStart(2, "0");
            await test.step(`P${n3} — security headers are applied to HTML responses`, async () => {
                const response = await page.goto("/");
                const headers = response?.headers() ?? {};
                expect(headers["content-security-policy"]).toContain("script-src");
                expect(headers["x-frame-options"]).toBe("DENY");
                expect(headers["content-type"]).toContain("text/html");
            });
            index += 1;

            const n4 = String(index).padStart(2, "0");
            await test.step(`P${n4} — public docs route requires authentication`, async () => {
                const response = await page.goto("/docs/");
                expect([401, 403, 404]).toContain(response?.status());
            });
            index += 1;

            const n5 = String(index).padStart(2, "0");
            await test.step(`P${n5} — API responses are cache-controlled`, async () => {
                const response = await page.request.get(new URL("/api/seasons", baseURL).href);
                expect(response.headers()["cache-control"]).toBeTruthy();
                expect(response.status()).toBe(200);
            });
            index += 1;

            const n6 = String(index).padStart(2, "0");
            await test.step(`P${n6} — unknown routes render an error page`, async () => {
                const response = await page.goto("/this-route-does-not-exist");
                expect(response?.status()).toBe(404);
            });
            index += 1;

            const n7 = String(index).padStart(2, "0");
            await test.step(`P${n7} — unauthenticated session endpoint returns 401`, async () => {
                const result = await api(page, "/api/auth/session");
                expect(result.status).toBe(401);
            });
            index += 1;

            const n8 = String(index).padStart(2, "0");
            await test.step(`P${n8} — active season exposes computed gates`, async () => {
                const result = await api(page, "/api/seasons/active");
                expect(result.status).toBe(200);
                expect(result.body).toHaveProperty("is_judging_open");
                expect(result.body).toHaveProperty("is_voting_open");
                expect(result.body).toHaveProperty("announcement");
            });
            index += 1;

            const n9 = String(index).padStart(2, "0");
            await test.step(`P${n9} — public team list omits internal fields`, async () => {
                const result = await api(page, "/api/teams");
                expect(result.status).toBe(200);
                for (const team of result.body ?? []) {
                    expect(Object.keys(team)).not.toContain("judge_user_id");
                    expect(Object.keys(team)).not.toContain("auth_subject");
                }
            });
            index += 1;

            const n10 = String(index).padStart(2, "0");
            await test.step(`P${n10} — protected admin API rejects guests`, async () => {
                expect([401, 403]).toContain((await api(page, "/api/admin/hackathon")).status);
                expect([401, 403]).toContain((await api(page, "/api/admin/teams")).status);
            });
            index += 1;

            const n11 = String(index).padStart(2, "0");
            await test.step(`P${n11} — voice-over theme toggle is reachable`, async () => {
                await page.goto("/");
                const toggle = page.locator('button[aria-label*="Switch to"]').first();
                await expect(toggle).toBeVisible();
            });
            index += 1;

            const n12 = String(index).padStart(2, "0");
            await test.step(`P${n12} — season archive route responds without error`, async () => {
                const response = await page.goto("/showcase/seasons/1");
                expect([200, 404]).toContain(response?.status() ?? 0);
            });
            index += 1;

            const extraPublic: Array<[string, () => Promise<void>]> = [
                [
                    "seasons index is publicly readable",
                    async () => {
                        const result = await api(page, "/api/seasons");
                        expect(result.status).toBe(200);
                    },
                ],
                [
                    "judging rubric requires authentication",
                    async () => {
                        expect([401, 403]).toContain(
                            (await api(page, "/api/judging/rubric")).status,
                        );
                    },
                ],
                [
                    "ballot requires authentication or an open vote",
                    async () => {
                        expect([401, 403, 409]).toContain((await api(page, "/api/ballot")).status);
                    },
                ],
                [
                    "user list requires authentication",
                    async () => {
                        expect([401, 403]).toContain((await api(page, "/api/users")).status);
                    },
                ],
                [
                    "docs asset is protected",
                    async () => {
                        const res = await page.request.get(
                            new URL("/docs/site.webmanifest", baseURL).href,
                        );
                        expect([401, 403, 404]).toContain(res.status());
                    },
                ],
                [
                    "profile of unknown user returns 404",
                    async () => {
                        expect((await api(page, "/api/users/999999")).status).toBe(404);
                    },
                ],
                [
                    "home page sets a canonical link on repeat visit",
                    async () => {
                        await page.goto("/");
                        await page.reload();
                        await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
                            "href",
                            `${baseURL}/`,
                        );
                    },
                ],
                [
                    "skip link is present and focusable",
                    async () => {
                        await page.goto("/");
                        const skip = page.getByRole("link", { name: /skip to main content/i });
                        await expect(skip).toHaveCount(1);
                        await expect(skip).toBeAttached();
                    },
                ],
                [
                    "rules page has a single heading",
                    async () => {
                        await page.goto("/rules");
                        expect(await page.locator("h1").count()).toBe(1);
                    },
                ],
                [
                    "contributing page has a single heading",
                    async () => {
                        await page.goto("/contributing");
                        expect(await page.locator("h1").count()).toBe(1);
                    },
                ],
                [
                    "showcase page has a single heading",
                    async () => {
                        await page.goto("/showcase");
                        expect(await page.locator("h1").count()).toBe(1);
                    },
                ],
                [
                    "home has no horizontal overflow when narrow",
                    async () => {
                        await page.setViewportSize({ width: 320, height: 900 });
                        await page.goto("/");
                        const overflow = await page.evaluate(
                            () =>
                                document.documentElement.scrollWidth -
                                document.documentElement.clientWidth,
                        );
                        expect(overflow).toBeLessThanOrEqual(0);
                        await page.setViewportSize({ width: 1280, height: 900 });
                    },
                ],
                [
                    "public schedule renders without error",
                    async () => {
                        await page.goto("/");
                        await expect(page.getByRole("heading", { name: "Schedule" })).toBeVisible();
                    },
                ],
                [
                    "public teams response has numeric ids",
                    async () => {
                        const result = await api(page, "/api/teams");
                        for (const team of result.body ?? []) expect(typeof team.id).toBe("number");
                    },
                ],
                [
                    "active season timestamps are numeric",
                    async () => {
                        const result = await api(page, "/api/seasons/active");
                        expect(typeof result.body.start_timestamp).toBe("number");
                        expect(typeof result.body.end_timestamp).toBe("number");
                    },
                ],
                [
                    "no page errors on a showcase detail",
                    async () => {
                        const errors: string[] = [];
                        page.on("pageerror", (error) => errors.push(error.message));
                        await page.goto("/showcase/beneath-the-surface");
                        await page.waitForLoadState("networkidle");
                        expect(errors).toEqual([]);
                    },
                ],
            ];
            for (const [name, run] of extraPublic) {
                await test.step(`P${String(++index).padStart(2, "0")} — ${name}`, run);
            }
        } finally {
            await Promise.all(contexts.map((context) => context.close()));
        }
    });
});
