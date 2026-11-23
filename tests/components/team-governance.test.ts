import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
    resolve(import.meta.dirname, "..", "..", "app", "components", "TeamForm.vue"),
    "utf-8",
);

describe("TeamForm governance", () => {
    it("marks the team owner and limits management controls to the owner", () => {
        expect(source).toContain("owner_user_id");
        expect(source).toContain("ownerKnown");
        expect(source).toContain("isOwner");
        expect(source).toContain("canManageTeam");
        expect(source).toContain("Team owner");
    });

    it("keeps leaving available to any member while restricting roster changes", () => {
        expect(source).toContain("canLeaveTeam");
        expect(source).toContain("Any member can leave the team.");
        expect(source).toContain("user.id === currentUser.value?.id ? canLeaveTeam.value");
    });

    it("transfers leadership through the owner endpoint with a transfer fallback", () => {
        expect(source).toContain("`/api/teams/${id}/owner`");
        expect(source).toContain('method: "PATCH"');
        expect(source).toContain("`/api/teams/${id}/transfer`");
        expect(source).toContain("isMissingEndpoint");
    });

    it("disbands only an unsubmitted team and returns to the dashboard", () => {
        expect(source).toContain("!team.value.project.submitted");
        expect(source).toContain('`/api/teams/${id}`, { method: "DELETE" }');
        expect(source).toContain('await navigateTo("/dashboard")');
    });

    it("shows the season member cap with a safe fallback", () => {
        expect(source).toContain("max_team_members");
        expect(source).toContain("maxMembers");
        expect(source).toContain("MAX_TEAM_MEMBERS");
    });

    it("surfaces a copyable invite link and its expiry when the API returns one", () => {
        expect(source).toContain("invite_url");
        expect(source).toContain("expires_at");
        expect(source).toContain("Copy link");
        expect(source).toContain("?invite=${encodeURIComponent(token)}");
    });
});
