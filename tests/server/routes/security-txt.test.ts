import { beforeAll, describe, expect, it, vi } from "vitest";

const headers: Array<[string, string]> = [];

describe("security.txt", () => {
    let handler: (event: unknown) => string;

    beforeAll(async () => {
        vi.stubGlobal("defineEventHandler", (value: unknown) => value);
        vi.stubGlobal("setHeader", (_event: unknown, name: string, value: string) => {
            headers.push([name, value]);
        });
        handler = (await import("~~/server/routes/.well-known/security.txt.get")).default;
    });

    it("serves an RFC 9116 contact file with a short cache", () => {
        vi.stubEnv("CURRENT_URL_ORIGIN", "https://basishacks.example.test");
        headers.length = 0;

        const body = handler({});

        expect(body).toContain("Contact: mailto:");
        expect(body).toContain("Expires:");
        expect(body).toContain(
            "Canonical: https://basishacks.example.test/.well-known/security.txt",
        );
        expect(headers).toContainEqual(["Content-Type", "text/plain; charset=utf-8"]);
        expect(headers).toContainEqual(["Cache-Control", "public, max-age=86400"]);
        vi.unstubAllEnvs();
    });

    it("omits canonical when no valid origin is configured", () => {
        vi.stubEnv("CURRENT_URL_ORIGIN", "");
        expect(handler({})).not.toContain("Canonical:");
        vi.unstubAllEnvs();
    });

    it("omits canonical when the origin variable is unset", () => {
        const original = process.env.CURRENT_URL_ORIGIN;
        delete process.env.CURRENT_URL_ORIGIN;
        try {
            expect(handler({})).not.toContain("Canonical:");
        } finally {
            if (original === undefined) delete process.env.CURRENT_URL_ORIGIN;
            else process.env.CURRENT_URL_ORIGIN = original;
        }
    });
});
