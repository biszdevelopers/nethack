import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
    resolve(import.meta.dirname, "..", "..", "app", "components", "NotificationBell.vue"),
    "utf-8",
);

describe("NotificationBell.vue", () => {
    it("loads the signed-in user's notifications from the notification endpoints", () => {
        expect(source).toContain('"/api/notifications"');
        expect(source).toContain("`/api/notifications/${notification.id}/read`");
        expect(source).toContain('"/api/notifications/read-all"');
    });

    it("only renders for authenticated users and reports the unread count", () => {
        expect(source).toContain('v-if="loggedIn"');
        expect(source).toContain("unreadCount");
        expect(source).toContain("`Notifications, ${unreadCount} unread`");
    });

    it("renders notification links only for safe internal paths", () => {
        expect(source).toContain("safeInternalPath");
        expect(source).toContain('link.startsWith("/")');
        expect(source).toContain("isSafeUrl(link)");
    });

    it("refreshes on focus and visibility without a polling timer", () => {
        expect(source).toContain('window.addEventListener("focus", onWindowFocus)');
        expect(source).toContain('document.addEventListener("visibilitychange"');
        expect(source).toContain("60_000");
        expect(source).not.toContain("setInterval");
    });
});
