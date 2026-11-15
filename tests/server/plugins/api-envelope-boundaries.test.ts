import { beforeAll, describe, expect, it, vi } from "vitest";

let beforeResponse: ((event: any, response: any) => void) | undefined;

beforeAll(async () => {
    vi.stubGlobal("defineNitroPlugin", (plugin: (app: any) => unknown) => plugin);
    const plugin = (await import("~~/server/plugins/api-envelope")).default;
    plugin({
        hooks: {
            hook(_name: string, callback: typeof beforeResponse) {
                beforeResponse = callback;
            },
        },
    });
});

describe("API response envelope fallback boundaries", () => {
    it("uses HTTP 200 when the response status code is zero", () => {
        const response = { body: { result: "created" } };
        beforeResponse!({ path: "/api/teams", node: { res: { statusCode: 0 } } }, response);

        expect(response.body).toEqual({
            status: 200,
            code: 200,
            data: { result: "created" },
        });
    });
});
