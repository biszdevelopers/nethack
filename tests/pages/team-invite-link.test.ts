import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
    resolve(import.meta.dirname, "..", "..", "app", "pages", "dashboard", "teams", "index.vue"),
    "utf-8",
);

describe("team invite links", () => {
    it("reads the invitation token from the query string", () => {
        expect(source).toContain("route.query.invite");
        expect(source).toContain("inviteToken");
    });

    it("accepts the token through the token endpoint", () => {
        expect(source).toContain("`/api/team-invites/token/${encodeURIComponent(token)}/accept`");
        expect(source).toContain('method: "POST"');
        expect(source).not.toContain('"/api/team-invites/accept"');
    });

    it("surfaces the server error and already-joined accounts", () => {
        expect(source).toContain("inviteError.value = getErrorMessage(e)");
        expect(source).not.toContain("isEndpointUnavailable");
        expect(source).toContain("You are already in a team");
    });

    it("clears the invite query after a dismissal", () => {
        expect(source).toContain("delete query.invite");
        expect(source).toContain("router.replace({ query })");
    });
});
