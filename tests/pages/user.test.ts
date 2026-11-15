import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
    resolve(import.meta.dirname, "..", "..", "app", "pages", "user", "index.vue"),
    "utf-8",
);

describe("User index page", () => {
    it("refreshes the session and redirects unauthenticated users to the login endpoint", () => {
        expect(source).toContain('middleware: "auth"');
        expect(source).toContain("/api/login?redirect=");
        expect(source).toContain("external: true");
        expect(source).toContain('throw await navigateTo("/user/" + userID.value)');
    });
});
