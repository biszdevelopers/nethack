# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: role-journeys.spec.ts >> participant and admin complete mobile journeys while judging and review stay keyboard-only
- Location: e2e/browser/role-journeys.spec.ts:460:1

# Error details

```
Error: WCAG 2.2 AA violations at 1024px: [
  {
    "id": "color-contrast",
    "impact": "serious",
    "tags": [
      "cat.color",
      "wcag2aa",
      "wcag143",
      "TTv5",
      "TT13.c",
      "EN-301-549",
      "EN-9.1.4.3",
      "ACT",
      "RGAAv4",
      "RGAA-3.2.1"
    ],
    "description": "Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds",
    "help": "Elements must meet minimum color contrast ratio thresholds",
    "helpUrl": "https://dequeuniversity.com/rules/axe/4.14/color-contrast?application=playwright",
    "nodes": [
      {
        "any": [
          {
            "id": "color-contrast",
            "data": {
              "fgColor": "#2b7fff",
              "bgColor": "#ffffff",
              "contrastRatio": 3.76,
              "fontSize": "12.0pt (16px)",
              "fontWeight": "normal",
              "messageKey": null,
              "expectedContrastRatio": "4.5:1",
              "shadowColor": "#9bc3ff"
            },
            "relatedNodes": [],
            "impact": "serious",
            "message": "Element has insufficient color contrast of 3.76 (foreground color: #2b7fff, background color: #ffffff, font size: 12.0pt (16px), font weight: normal). Expected contrast ratio of 4.5:1"
          }
        ],
        "all": [],
        "none": [],
        "impact": "serious",
        "html": "<span class=\"text-secondary bold\">devs</span>",
        "target": [
          ".text-secondary"
        ],
        "failureSummary": "Fix any of the following:\n  Element has insufficient color contrast of 3.76 (foreground color: #2b7fff, background color: #ffffff, font size: 12.0pt (16px), font weight: normal). Expected contrast ratio of 4.5:1"
      }
    ]
  }
]

expect(received).toEqual(expected) // deep equality

- Expected  -  1
+ Received  + 52

- Array []
+ Array [
+   Object {
+     "description": "Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds",
+     "help": "Elements must meet minimum color contrast ratio thresholds",
+     "helpUrl": "https://dequeuniversity.com/rules/axe/4.14/color-contrast?application=playwright",
+     "id": "color-contrast",
+     "impact": "serious",
+     "nodes": Array [
+       Object {
+         "all": Array [],
+         "any": Array [
+           Object {
+             "data": Object {
+               "bgColor": "#ffffff",
+               "contrastRatio": 3.76,
+               "expectedContrastRatio": "4.5:1",
+               "fgColor": "#2b7fff",
+               "fontSize": "12.0pt (16px)",
+               "fontWeight": "normal",
+               "messageKey": null,
+               "shadowColor": "#9bc3ff",
+             },
+             "id": "color-contrast",
+             "impact": "serious",
+             "message": "Element has insufficient color contrast of 3.76 (foreground color: #2b7fff, background color: #ffffff, font size: 12.0pt (16px), font weight: normal). Expected contrast ratio of 4.5:1",
+             "relatedNodes": Array [],
+           },
+         ],
+         "failureSummary": "Fix any of the following:
+   Element has insufficient color contrast of 3.76 (foreground color: #2b7fff, background color: #ffffff, font size: 12.0pt (16px), font weight: normal). Expected contrast ratio of 4.5:1",
+         "html": "<span class=\"text-secondary bold\">devs</span>",
+         "impact": "serious",
+         "none": Array [],
+         "target": Array [
+           ".text-secondary",
+         ],
+       },
+     ],
+     "tags": Array [
+       "cat.color",
+       "wcag2aa",
+       "wcag143",
+       "TTv5",
+       "TT13.c",
+       "EN-301-549",
+       "EN-9.1.4.3",
+       "ACT",
+       "RGAAv4",
+       "RGAA-3.2.1",
+     ],
+   },
+ ]
```

# Test source

```ts
  1   | import AxeBuilder from "@axe-core/playwright";
  2   | import { mkdir, readFile, writeFile } from "node:fs/promises";
  3   | import { resolve } from "node:path";
  4   | import {
  5   |     expect,
  6   |     test,
  7   |     type Browser,
  8   |     type BrowserContext,
  9   |     type Locator,
  10  |     type Page,
  11  | } from "@playwright/test";
  12  | 
  13  | const baseURL = process.env.PLAYWRIGHT_BASE_URL;
  14  | if (!baseURL) throw new Error("Set PLAYWRIGHT_BASE_URL in .env for the browser tests.");
  15  | const accessibilityTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
  16  | const responsiveWidths = [320, 375, 768, 1024, 1440] as const;
  17  | const boardDemoEnabled = process.env.BOARD_DEMO_CAPTURE === "1";
  18  | const boardDemoDir = resolve(process.cwd(), "artifacts/board-demo/captures");
  19  | 
  20  | async function captureBoardDemo(page: Page, id: string, title: string) {
  21  |     if (!boardDemoEnabled) return;
  22  |     const originalViewport = page.viewportSize();
  23  |     await page.setViewportSize({ width: 1440, height: 960 });
  24  |     await mkdir(boardDemoDir, { recursive: true });
  25  |     const filename = `${id}.png`;
  26  |     await page.screenshot({ path: resolve(boardDemoDir, filename), fullPage: true });
  27  |     const manifestPath = resolve(boardDemoDir, "manifest.json");
  28  |     let chapters: { id: string; title: string; image: string }[] = [];
  29  |     try {
  30  |         chapters = JSON.parse(await readFile(manifestPath, "utf8"));
  31  |     } catch {
  32  |         // The first screenshot creates the capture manifest.
  33  |     }
  34  |     chapters = chapters.filter((chapter) => chapter.id !== id);
  35  |     chapters.push({ id, title, image: filename });
  36  |     await writeFile(manifestPath, `${JSON.stringify(chapters, null, 2)}\n`);
  37  |     if (originalViewport) await page.setViewportSize(originalViewport);
  38  | }
  39  | 
  40  | async function newMobilePage(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  41  |     const context = await browser.newContext({
  42  |         baseURL,
  43  |         viewport: { width: 320, height: 900 },
  44  |     });
  45  |     return { context, page: await context.newPage() };
  46  | }
  47  | 
  48  | async function loginAs(page: Page, email: string, redirectPath: string) {
  49  |     await page.goto(`/api/login?redirect=${encodeURIComponent(redirectPath)}`);
  50  |     await expect(page.getByRole("heading", { name: "Choose a test identity" })).toBeVisible();
  51  |     const consentResponse = page.waitForResponse(
  52  |         (response) =>
  53  |             new URL(response.url()).pathname === "/authorize/consent" &&
  54  |             response.request().method() === "POST",
  55  |     );
  56  |     await page.getByRole("button").filter({ hasText: email }).click();
  57  |     const consent = await consentResponse;
  58  |     const consentBody = consent.status() === 302 ? "" : await consent.text();
  59  |     expect(
  60  |         consent.status(),
  61  |         `OIDC test provider consent failed with HTTP ${consent.status()}: ${consentBody}`,
  62  |     ).toBe(302);
  63  |     await expect(page).toHaveURL((url) => url.pathname === redirectPath);
  64  | }
  65  | 
  66  | async function expectResponsivePage(page: Page) {
  67  |     const originalViewport = page.viewportSize();
  68  |     try {
  69  |         for (const width of responsiveWidths) {
  70  |             console.info(`[responsive-a11y] ${new URL(page.url()).pathname} ${width}px`);
  71  |             await page.setViewportSize({ width, height: 900 });
  72  |             const dimensions = await page.evaluate(() => ({
  73  |                 viewport: document.documentElement.clientWidth,
  74  |                 document: document.documentElement.scrollWidth,
  75  |                 body: document.body.scrollWidth,
  76  |             }));
  77  |             expect(dimensions.document, `document overflow at ${width}px`).toBeLessThanOrEqual(
  78  |                 dimensions.viewport,
  79  |             );
  80  |             expect(dimensions.body, `body overflow at ${width}px`).toBeLessThanOrEqual(
  81  |                 dimensions.viewport,
  82  |             );
  83  | 
  84  |             const results = await new AxeBuilder({ page }).withTags(accessibilityTags).analyze();
  85  |             expect(
  86  |                 results.violations,
  87  |                 `WCAG 2.2 AA violations at ${width}px: ${JSON.stringify(results.violations, null, 2)}`,
> 88  |             ).toEqual([]);
      |               ^ Error: WCAG 2.2 AA violations at 1024px: [
  89  |             console.info(`[responsive-a11y-complete] ${new URL(page.url()).pathname} ${width}px`);
  90  |         }
  91  |     } finally {
  92  |         if (originalViewport) await page.setViewportSize(originalViewport);
  93  |     }
  94  | }
  95  | 
  96  | async function expectTouchTarget(target: Locator) {
  97  |     await expect(target).toBeVisible();
  98  |     const box = await target.boundingBox();
  99  |     expect(box).not.toBeNull();
  100 |     if (!box) throw new Error("The expected touch target is not visible.");
  101 |     expect(box.width).toBeGreaterThanOrEqual(44);
  102 |     expect(box.height).toBeGreaterThanOrEqual(44);
  103 | }
  104 | 
  105 | function apiResponse(page: Page, path: string, method: string) {
  106 |     return page.waitForResponse(
  107 |         (response) =>
  108 |             new URL(response.url()).pathname === path && response.request().method() === method,
  109 |         { timeout: 15_000 },
  110 |     );
  111 | }
  112 | 
  113 | async function openSeasonTab(page: Page, name: string) {
  114 |     const tab = page.getByRole("tab", { name, exact: true });
  115 |     await expect(tab).toBeVisible();
  116 |     if ((await tab.getAttribute("aria-selected")) !== "true") await tab.click();
  117 | }
  118 | 
  119 | async function setSeasonStatus(page: Page, status: string) {
  120 |     await openSeasonTab(page, "Event settings");
  121 |     const configuration = page
  122 |         .getByRole("heading", { name: "Hackathon Configuration" })
  123 |         .locator("xpath=ancestor::section[1]");
  124 |     const selector = configuration.getByRole("combobox").first();
  125 |     await expectTouchTarget(selector);
  126 |     if ((await selector.innerText()).trim().includes(status)) return;
  127 | 
  128 |     const saved = apiResponse(page, "/api/admin/hackathon", "PATCH");
  129 |     await selector.click();
  130 |     await page.getByRole("option", { name: status, exact: true }).click();
  131 |     expect((await saved).ok()).toBeTruthy();
  132 | }
  133 | 
  134 | async function setSeasonCheckbox(page: Page, label: string, checked: boolean) {
  135 |     await openSeasonTab(page, "Event settings");
  136 |     const configuration = page
  137 |         .getByRole("heading", { name: "Hackathon Configuration" })
  138 |         .locator("xpath=ancestor::section[1]");
  139 |     const checkbox = configuration.getByRole("checkbox", { name: label });
  140 |     const checkboxId = await checkbox.getAttribute("id");
  141 |     expect(checkboxId).toBeTruthy();
  142 |     if (!checkboxId) throw new Error(`The ${label} checkbox has no associated label.`);
  143 |     await expectTouchTarget(configuration.locator(`label[for="${checkboxId}"]`));
  144 |     if ((await checkbox.isChecked()) === checked) return;
  145 | 
  146 |     const saved = apiResponse(page, "/api/admin/hackathon", "PATCH");
  147 |     if (checked) await checkbox.check();
  148 |     else await checkbox.uncheck();
  149 |     expect((await saved).ok()).toBeTruthy();
  150 | }
  151 | 
  152 | async function setScoreCurve(page: Page, label: string) {
  153 |     await openSeasonTab(page, "Scoring");
  154 |     const section = page
  155 |         .getByRole("heading", { name: "Score display curve" })
  156 |         .locator("xpath=ancestor::section[1]");
  157 |     const selector = section.getByRole("combobox");
  158 |     await expectTouchTarget(selector);
  159 |     if ((await selector.innerText()).includes(label)) return;
  160 | 
  161 |     const saved = apiResponse(page, "/api/admin/seasons/1/score-curve", "PATCH");
  162 |     await selector.click();
  163 |     await page.getByRole("option", { name: label, exact: true }).click();
  164 |     expect((await saved).ok()).toBeTruthy();
  165 | }
  166 | 
  167 | async function createAndSubmitProject(
  168 |     page: Page,
  169 |     teamName: string,
  170 |     projectName: string,
  171 |     checkResponsiveLayouts = false,
  172 |     capturePrefix?: string,
  173 | ) {
  174 |     await page.goto("/dashboard/teams");
  175 |     await expect(page.getByRole("heading", { name: "Create a team" })).toBeVisible();
  176 |     if (capturePrefix) {
  177 |         await captureBoardDemo(page, `${capturePrefix}-team`, "Create a participant team");
  178 |     }
  179 |     await page.getByLabel("Team name").fill(teamName);
  180 | 
  181 |     const createButton = page.getByRole("button", { name: "Create", exact: true });
  182 |     await expectTouchTarget(createButton);
  183 |     const teamCreation = page.waitForResponse(
  184 |         (response) =>
  185 |             new URL(response.url()).pathname === "/api/teams" &&
  186 |             response.request().method() === "POST",
  187 |     );
  188 |     await createButton.focus();
```