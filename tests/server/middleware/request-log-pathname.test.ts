import { beforeAll, describe, expect, it, vi } from "vitest";

describe("request log pathname fallback", () => {
    let requestLogMiddleware: (event: any) => void;

    beforeAll(async () => {
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
        requestLogMiddleware = (await import("~~/server/middleware/00.request-log")).default;
    });

    it("logs a query-only request under the root pathname", () => {
        vi.stubEnv("NODE_ENV", "production");
        const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
        const finishHandlers: Array<() => void> = [];
        const event = {
            path: "?invite=secret",
            method: "get",
            context: {},
            node: {
                res: {
                    statusCode: 204,
                    once: (_name: string, handler: () => void) => finishHandlers.push(handler),
                },
            },
        };

        requestLogMiddleware(event);
        finishHandlers[0]!();

        const logged = JSON.parse(String(info.mock.calls[0]?.[0]));
        expect(logged).toMatchObject({ method: "GET", pathname: "/", status: 204 });
        expect(JSON.stringify(logged)).not.toContain("invite=secret");
        info.mockRestore();
        vi.unstubAllEnvs();
    });
});
