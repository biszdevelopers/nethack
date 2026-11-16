# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: routes.spec.ts >> participant routes render without errors at every width
- Location: e2e/browser/routes.spec.ts:144:1

# Error details

```
Error: /dashboard at 320px should render a heading

expect(locator).toBeVisible() failed

Locator: getByRole('heading').first()
Expected: visible
Timeout: 20000ms
Error: element(s) not found

Call log:
  - /dashboard at 320px should render a heading getByRole('heading').first() with timeout 20000ms
  - waiting for getByRole('heading').first()

```

```yaml
- link "Skip to main content":
  - /url: "#main-content"
- banner:
  - link "nethack":
    - /url: /
  - link "Open your profile":
    - /url: /profile
    - img "Participant Fixture"
  - button "Open menu"
- main:
  - navigation "Mobile navigation":
    - link "Overview":
      - /url: /dashboard
    - link "Team":
      - /url: /dashboard/teams
    - link "General":
      - /url: /dashboard/general
    - link "Results":
      - /url: /dashboard/results
    - link "Help":
      - /url: https://teams.microsoft.com/l/channel/19%3Ae352153b90524d81b9f9b50c7dd84d12%40thread.tacv2/QnA?groupId=b207a655-d801-4200-8345-5dcc50d6d957&tenantId=cbc6e1e2-a6bb-4002-bbdc-6da892a051a7
  - text: You can also hover or expand the dashboard tab to see more options
  - button "Close"
  - paragraph:
    - text: Welcome Participant Fixture ! You don't have a team yet. You can
    - link "create a team":
      - /url: /dashboard/teams
    - text: or accept an invitation from another team!
- separator
- contentinfo:
  - link "Teams":
    - /url: https://teams.microsoft.com/l/channel/19%3AS3B3lM0EUkIeBixZSQN6dZanoQv5GfVFr6kiVuf_P3U1%40thread.tacv2/General?groupId=b207a655-d801-4200-8345-5dcc50d6d957&tenantId=cbc6e1e2-a6bb-4002-bbdc-6da892a051a7
    - img
  - link "GitHub":
    - /url: https://github.com/basishacks/basishacks-r2
  - navigation:
    - list:
      - listitem:
        - link "biszweb.club":
          - /url: https://biszweb.club/clubs/developers_club
      - listitem:
        - link "binj.dev":
          - /url: https://binj.dev
  - paragraph: 2026 BISZ Developers' Club, BINJ Hack Club
  - link "Contribute to nethack":
    - /url: /contributing
- region "Notifications (F8)":
  - list
```

# Test source

```ts
  1   | import AxeBuilder from "@axe-core/playwright";
  2   | import { expect, test, type Page } from "@playwright/test";
  3   | 
  4   | const baseURL = process.env.PLAYWRIGHT_BASE_URL;
  5   | if (!baseURL) throw new Error("Set PLAYWRIGHT_BASE_URL in .env for the browser tests.");
  6   | 
  7   | const widths = [320, 1440] as const;
  8   | const accessibilityTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
  9   | 
  10  | const PUBLIC_ROUTES = [
  11  |     "/",
  12  |     "/rules",
  13  |     "/contributing",
  14  |     "/showcase",
  15  |     "/showcase/signal",
  16  |     "/showcase/beneath-the-surface",
  17  |     "/showcase/seasons/1",
  18  |     "/seasons/1",
  19  | ] as const;
  20  | 
  21  | const PARTICIPANT_ROUTES = [
  22  |     "/dashboard",
  23  |     "/dashboard/general",
  24  |     "/dashboard/presentation",
  25  |     "/dashboard/results",
  26  |     "/dashboard/teams",
  27  |     "/profile",
  28  |     "/user",
  29  |     "/voting",
  30  | ] as const;
  31  | 
  32  | const JUDGE_ROUTES = ["/judging", "/judging/history/1"] as const;
  33  | 
  34  | const ADMIN_ROUTES = [
  35  |     "/developers",
  36  |     "/developers/season",
  37  |     "/developers/teams",
  38  |     "/developers/users",
  39  |     "/developers/docs",
  40  | ] as const;
  41  | 
  42  | async function loginAs(page: Page, email: string, redirectPath: string) {
  43  |     await page.goto(`/api/login?redirect=${encodeURIComponent(redirectPath)}`);
  44  |     await expect(page.getByRole("heading", { name: "Choose a test identity" })).toBeVisible();
  45  |     const consentResponse = page.waitForResponse(
  46  |         (response) =>
  47  |             new URL(response.url()).pathname === "/authorize/consent" &&
  48  |             response.request().method() === "POST",
  49  |     );
  50  |     await page.getByRole("button").filter({ hasText: email }).click();
  51  |     expect((await consentResponse).status()).toBe(302);
  52  |     await expect(page).toHaveURL((url) => url.pathname === redirectPath);
  53  | }
  54  | 
  55  | async function sweep(page: Page, routes: readonly string[]) {
  56  |     const pageErrors: string[] = [];
  57  |     const serverErrors: string[] = [];
  58  |     page.on("pageerror", (error) => pageErrors.push(error.message));
  59  |     page.on("response", (response) => {
  60  |         if (response.status() >= 500) {
  61  |             serverErrors.push(`${response.status()} ${new URL(response.url()).pathname}`);
  62  |         }
  63  |     });
  64  | 
  65  |     for (const route of routes) {
  66  |         for (const scheme of ["dark", "light"] as const) {
  67  |             await page.emulateMedia({ colorScheme: scheme });
  68  |             for (const width of widths) {
  69  |                 pageErrors.length = 0;
  70  |                 serverErrors.length = 0;
  71  |                 await page.setViewportSize({ width, height: 900 });
  72  | 
  73  |                 const response = await page.goto(route, { waitUntil: "load" });
  74  |                 const status = response?.status() ?? 0;
  75  |                 // The archive route intentionally 404s while the season it names is
  76  |                 // still active; it only opens for finished, inactive seasons.
  77  |                 const archiveMayBeMissing = route === "/showcase/seasons/1";
  78  |                 expect(
  79  |                     status < 400 || (archiveMayBeMissing && status === 404),
  80  |                     `${route} returned HTTP ${status}`,
  81  |                 ).toBe(true);
  82  | 
  83  |                 if (route === "/developers/docs") {
  84  |                     await expect(
  85  |                         page.locator('iframe[title="nethack documentation"]'),
  86  |                         `${route} at ${width}px should embed the docs`,
  87  |                     ).toBeVisible({ timeout: 20_000 });
  88  |                 } else {
  89  |                     await expect(
  90  |                         page.getByRole("heading").first(),
  91  |                         `${route} at ${width}px should render a heading`,
> 92  |                     ).toBeVisible({ timeout: 20_000 });
      |                       ^ Error: /dashboard at 320px should render a heading
  93  |                 }
  94  | 
  95  |                 await expect
  96  |                     .poll(
  97  |                         () =>
  98  |                             page.evaluate(
  99  |                                 () =>
  100 |                                     document.documentElement.scrollWidth -
  101 |                                     document.documentElement.clientWidth,
  102 |                             ),
  103 |                         { timeout: 10_000, message: `${route} overflows at ${width}px` },
  104 |                     )
  105 |                     .toBeLessThanOrEqual(0);
  106 | 
  107 |                 if (status < 400) {
  108 |                     expect(
  109 |                         await page.evaluate(() =>
  110 |                             document.documentElement.classList.contains("dark"),
  111 |                         ),
  112 |                         `${route} should render the ${scheme} surface`,
  113 |                     ).toBe(scheme === "dark");
  114 |                 }
  115 | 
  116 |                 if (width === 320) {
  117 |                     const accessibility = await new AxeBuilder({ page })
  118 |                         .withTags(accessibilityTags)
  119 |                         .analyze();
  120 |                     expect(
  121 |                         accessibility.violations,
  122 |                         `${route} at ${width}px in ${scheme} mode: ${JSON.stringify(accessibility.violations, null, 2)}`,
  123 |                     ).toEqual([]);
  124 |                 }
  125 | 
  126 |                 expect(
  127 |                     pageErrors,
  128 |                     `${route} at ${width}px in ${scheme} mode threw in the browser`,
  129 |                 ).toEqual([]);
  130 |                 expect(
  131 |                     serverErrors,
  132 |                     `${route} at ${width}px in ${scheme} mode returned a server error`,
  133 |                 ).toEqual([]);
  134 |             }
  135 |         }
  136 |     }
  137 | }
  138 | 
  139 | test("public routes render without errors at every width", async ({ page }) => {
  140 |     test.setTimeout(360_000);
  141 |     await sweep(page, PUBLIC_ROUTES);
  142 | });
  143 | 
  144 | test("participant routes render without errors at every width", async ({ page }) => {
  145 |     test.setTimeout(480_000);
  146 |     await loginAs(page, "participant@e2e.basishacks.invalid", "/dashboard");
  147 |     await sweep(page, PARTICIPANT_ROUTES);
  148 | });
  149 | 
  150 | test("judge routes render without errors at every width", async ({ page }) => {
  151 |     test.setTimeout(360_000);
  152 |     await loginAs(page, "judge@e2e.basishacks.invalid", "/judging");
  153 |     await sweep(page, JUDGE_ROUTES);
  154 | });
  155 | 
  156 | test("administrator routes render without errors at every width", async ({ page }) => {
  157 |     test.setTimeout(480_000);
  158 |     await loginAs(page, "admin@e2e.basishacks.invalid", "/developers");
  159 |     await sweep(page, ADMIN_ROUTES);
  160 | });
  161 | 
  162 | test("anonymous visitors are redirected away from protected pages", async ({ page }) => {
  163 |     for (const route of ["/dashboard", "/dashboard/teams", "/developers", "/judging"] as const) {
  164 |         await page.goto(route);
  165 |         await expect(page, `${route} should not render for an anonymous visitor`).not.toHaveURL(
  166 |             (url) => url.pathname === route,
  167 |         );
  168 |         await expect(page.getByRole("heading", { name: "Choose a test identity" })).toBeVisible();
  169 |     }
  170 | });
  171 | 
```