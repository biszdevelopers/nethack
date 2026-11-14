import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
    resolve(import.meta.dirname, "..", "..", "app", "pages", "profile.vue"),
    "utf-8",
);

describe("profile page", () => {
    it("loads the signed-in user's API record through the session-aware composable", () => {
        expect(source).toContain("await useApiUser()");
        expect(source).not.toContain("await useFetch(() => `/api/users/");
    });
});
