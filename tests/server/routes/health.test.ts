import { beforeAll, describe, expect, it, vi } from "vitest";

const state = {
    status: undefined as number | undefined,
    headers: [] as Array<[string, string]>,
    client: undefined as undefined | (() => Promise<unknown>),
};

vi.mock("~~/server/database", () => ({
    getPostgresClient: () => {
        if (!state.client) throw new Error("The PostgreSQL client has not been initialized.");
        return state.client;
    },
}));

describe("health routes", () => {
    let live: (event: any) => unknown;
    let ready: (event: any) => Promise<unknown>;

    beforeAll(async () => {
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
        vi.stubGlobal("setHeader", (_event: unknown, name: string, value: string) => {
            state.headers.push([name, value]);
        });
        vi.stubGlobal("setResponseStatus", (_event: unknown, status: number) => {
            state.status = status;
        });
        live = (await import("~~/server/routes/api/health/live.get")).default;
        ready = (await import("~~/server/routes/api/health/ready.get")).default;
    });

    const eventFor = (client?: () => Promise<unknown>) => {
        state.client = client;
        return { path: "/api/health", context: {} };
    };

    it("reports live without touching the database", () => {
        state.headers = [];
        expect(live(eventFor())).toEqual({ status: "ok" });
        expect(state.headers).toContainEqual(["Cache-Control", "no-store"]);
    });

    it("adds optional uptime when HEALTH_DETAILS is enabled", () => {
        vi.stubEnv("HEALTH_DETAILS", "1");
        const body = live(eventFor()) as { status: string; uptime_s?: number };
        expect(body.status).toBe("ok");
        expect(typeof body.uptime_s).toBe("number");
        vi.unstubAllEnvs();
    });

    it("reports ready when SELECT 1 succeeds", async () => {
        state.headers = [];
        const execute = vi.fn(async () => [{ "?column?": 1 }]);
        state.status = undefined;

        await expect(ready(eventFor(() => execute()))).resolves.toEqual({ status: "ok" });
        expect(execute).toHaveBeenCalledOnce();
        expect(state.status).toBeUndefined();
        expect(state.headers).toContainEqual(["Cache-Control", "no-store"]);
    });

    it("skips timer cleanup when the host returns no timer handle", async () => {
        const execute = vi.fn(async () => [{ "?column?": 1 }]);
        const timeout = vi.spyOn(globalThis, "setTimeout").mockReturnValueOnce(undefined as never);
        try {
            await expect(ready(eventFor(() => execute()))).resolves.toEqual({ status: "ok" });
        } finally {
            timeout.mockRestore();
        }
    });

    it("reports unavailable with 503 when the query fails or the pool is missing", async () => {
        state.status = undefined;
        await expect(
            ready(eventFor(() => Promise.reject(new Error("postgres://secret")))),
        ).resolves.toEqual({ status: "unavailable" });
        expect(state.status).toBe(503);

        state.status = undefined;
        await expect(ready(eventFor())).resolves.toEqual({ status: "unavailable" });
        expect(state.status).toBe(503);
    });

    it("fails readiness within the deadline instead of hanging", async () => {
        vi.useFakeTimers();
        try {
            const pending = new Promise<never>(() => undefined);
            const responsePromise = ready(eventFor(() => pending));
            await vi.advanceTimersByTimeAsync(2_000);
            await expect(responsePromise).resolves.toEqual({ status: "unavailable" });
        } finally {
            vi.useRealTimers();
        }
    });
});
