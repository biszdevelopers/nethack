import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
    resolve(import.meta.dirname, "..", "..", "app", "pages", "profile.vue"),
    "utf-8",
);

describe("profile page", () => {
    it("loads the authenticated API user through useApiUser", () => {
        expect(source).toContain("await useApiUser()");
        expect(source).not.toContain("await useFetch(() => `/api/users/");
    });
});
