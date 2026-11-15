import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
    resolve(import.meta.dirname, "..", "..", "app", "components", "UserAvatarGroup.vue"),
    "utf-8",
);

describe("UserAvatarGroup.vue", () => {
    it("exposes a developerMode prop", () => {
        expect(source).toContain("developerMode?: boolean");
    });

    it("accepts users with an id field", () => {
        expect(source).toContain("id?: number");
    });

    it("shows the user id in grayed angle brackets beside the name in developer mode", () => {
        expect(source).toContain('v-if="developerMode && user?.id != null"');
        expect(source).toContain("text-muted");
        expect(source).toContain("&lt;{{ user.id }}&gt;");
    });
});
