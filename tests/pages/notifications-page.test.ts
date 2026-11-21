import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
    resolve(import.meta.dirname, "..", "..", "app", "pages", "notifications.vue"),
    "utf-8",
);

describe("notifications page", () => {
    it("requires authentication and titles the page", () => {
        expect(source).toContain('middleware: ["auth"]');
        expect(source).toContain("useHead({ title: `Notifications | ${WEBSITE_NAME}` })");
    });

    it("lists notifications and marks them read", () => {
        expect(source).toContain('"/api/notifications"');
        expect(source).toContain("`/api/notifications/${notification.id}/read`");
        expect(source).toContain('"/api/notifications/read-all"');
        expect(source).toContain("Mark all read");
    });

    it("only links to safe internal paths", () => {
        expect(source).toContain("safeInternalPath");
        expect(source).toContain('link.startsWith("/")');
        expect(source).toContain("isSafeUrl(link)");
    });
});
