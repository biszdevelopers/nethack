import { beforeAll, describe, expect, it, vi } from "vitest";

describe("security.txt without a configured origin", () => {
    let handler: (event: unknown) => string;

    beforeAll(async () => {
        vi.stubGlobal("defineEventHandler", (value: unknown) => value);
        vi.stubGlobal("setHeader", () => undefined);
        handler = (await import("~~/server/routes/.well-known/security.txt.get")).default;
    });

    it("omits the canonical line when CURRENT_URL_ORIGIN is unset", () => {
        vi.unstubAllEnvs();
        delete process.env.CURRENT_URL_ORIGIN;

        expect(handler({})).not.toContain("Canonical:");
    });
});
