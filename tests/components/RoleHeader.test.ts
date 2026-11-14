import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
    resolve(import.meta.dirname, "..", "..", "app", "components", "RoleHeader.vue"),
    "utf-8",
);

describe("RoleHeader.vue", () => {
    it("uses useApiUser instead of useUserSession and useFetch for the user", () => {
        expect(source).toContain("useApiUser");
        expect(source).not.toContain("useFetch<GetUserResponse>");
        expect(source).not.toContain("useUserSession()");
    });

    it("renders the hackathon title basishacks_2026", () => {
        expect(source).toContain("basishacks_2026");
    });

    it("keeps the brand and mobile header controls usable on narrow touch screens", () => {
        expect(source).toContain("text-base text-primary sm:text-xl");
        expect(source).toContain("min-h-11 min-w-11");
        expect(source).toContain(":ui=\"{ link: 'min-h-11' }\"");
    });

    it("includes a Home navigation item", () => {
        expect(source).toContain("Home");
        expect(source).toContain('to: "/"');
    });

    it("includes a Dashboard navigation item", () => {
        expect(source).toContain("Dashboard");
        expect(source).toContain('to: "/dashboard"');
    });

    it("includes a Showcase navigation item", () => {
        expect(source).toContain("Showcase");
        expect(source).toContain('to: "/showcase"');
    });

    it("conditionally shows Voting when judging access is absent during voting", () => {
        expect(source).toContain('hackathon.value?.status === "voting"');
        expect(source).toContain("!can(NethackPermissions.Judging.assignmentsRead)");
        expect(source).toContain('to: "/voting"');
    });

    it("conditionally shows Judging when judging access is granted during voting", () => {
        expect(source).toContain("can(NethackPermissions.Judging.assignmentsRead)");
        expect(source).toContain('to: "/judging"');
    });

    it("includes a UColorModeButton for theme toggling", () => {
        expect(source).toContain("UColorModeButton");
    });

    it("has a profile button linking to /profile", () => {
        expect(source).toContain('href="/profile"');
    });

    it("shows UserAvatar when user is logged in", () => {
        expect(source).toContain("UserAvatar");
        expect(source).toContain('v-if="userRef"');
    });

    it("shows account-circle icon when user is not logged in", () => {
        expect(source).toContain("i-material-symbols-account-circle-full");
        expect(source).toContain("v-else");
    });

    it("uses lazy data fetching for hackathon and user data", () => {
        expect(source).toContain("lazy: true");
    });

    it("uses the shared nethack permission composable", () => {
        expect(source).toContain('import { NethackPermissions } from "~~/shared/permissions"');
        expect(source).toContain("useNethackPermissions()");
    });
});
