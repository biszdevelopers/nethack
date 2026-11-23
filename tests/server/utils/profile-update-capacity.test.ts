import { afterEach, describe, expect, it, vi } from "vitest";
import {
    MAX_CONCURRENT_PROFILE_UPDATES,
    MAX_IN_FLIGHT_PROFILE_UPDATES,
    withProfileUpdateCapacity,
} from "~~/server/utils/profile-update-capacity";

function deferred<T = void>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

function eventWithResponse() {
    const setHeader = vi.fn();
    return {
        event: { node: { res: { setHeader } } } as never,
        setHeader,
    };
}

describe("profile update capacity", () => {
    it("allows one in-flight update per user and returns retry guidance", async () => {
        expect(MAX_IN_FLIGHT_PROFILE_UPDATES).toBe(1);

        const firstStarted = deferred();
        const finishFirst = deferred();
        const firstEvent = eventWithResponse();
        const first = withProfileUpdateCapacity(firstEvent.event, 41, async () => {
            firstStarted.resolve();
            await finishFirst.promise;
            return "complete";
        });
        await firstStarted.promise;

        const secondEvent = eventWithResponse();
        const secondOperation = vi.fn(async () => "must not run");
        await expect(
            withProfileUpdateCapacity(secondEvent.event, 41, secondOperation),
        ).rejects.toMatchObject({
            statusCode: 503,
            message: "Profile updates are temporarily busy. Please retry in a moment.",
        });

        expect(secondEvent.setHeader).toHaveBeenCalledWith("Retry-After", "2");
        expect(secondOperation).not.toHaveBeenCalled();

        finishFirst.resolve();
        await expect(first).resolves.toBe("complete");
    });

    it("does not let one slow user block another user", async () => {
        const release = deferred();
        const slow = withProfileUpdateCapacity(eventWithResponse().event, 51, async () => {
            await release.promise;
            return "slow";
        });

        await expect(
            withProfileUpdateCapacity(eventWithResponse().event, 52, async () => "fast"),
        ).resolves.toBe("fast");

        release.resolve();
        await expect(slow).resolves.toBe("slow");
    });

    it("caps concurrent updates across all users", async () => {
        const release = deferred();
        const running = Array.from({ length: MAX_CONCURRENT_PROFILE_UPDATES }, (_, index) =>
            withProfileUpdateCapacity(eventWithResponse().event, 100 + index, async () => {
                await release.promise;
            }),
        );

        await expect(
            withProfileUpdateCapacity(eventWithResponse().event, 200, async () => "blocked"),
        ).rejects.toMatchObject({ statusCode: 503 });

        release.resolve();
        await Promise.all(running);
    });

    it("releases capacity when an update fails", async () => {
        const failure = new Error("write failed");

        await expect(
            withProfileUpdateCapacity(eventWithResponse().event, 61, async () => {
                throw failure;
            }),
        ).rejects.toBe(failure);

        await expect(
            withProfileUpdateCapacity(eventWithResponse().event, 61, async () => "available"),
        ).resolves.toBe("available");
    });
});

describe("profile update deadlines", () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it("returns 408 when the body read exceeds the deadline", async () => {
        vi.stubEnv("PROFILE_UPDATE_DEADLINE_MS", "10");
        const started = Date.now();

        await expect(
            withProfileUpdateCapacity(
                eventWithResponse().event,
                71,
                () => new Promise(() => undefined),
            ),
        ).rejects.toMatchObject({ statusCode: 408, statusMessage: "Request Timeout" });
        expect(Date.now() - started).toBeLessThan(2_000);
    });

    it("releases the slot after a timed-out read so the same user can retry", async () => {
        vi.stubEnv("PROFILE_UPDATE_DEADLINE_MS", "10");

        await expect(
            withProfileUpdateCapacity(
                eventWithResponse().event,
                72,
                () => new Promise(() => undefined),
            ),
        ).rejects.toMatchObject({ statusCode: 408 });

        await expect(
            withProfileUpdateCapacity(eventWithResponse().event, 72, async () => "retried"),
        ).resolves.toBe("retried");
    });

    it("keeps profile saves available while several uploads are slow", async () => {
        const release = deferred();
        const slow = Array.from({ length: 4 }, (_, index) =>
            withProfileUpdateCapacity(eventWithResponse().event, 300 + index, async () => {
                await release.promise;
                return "slow";
            }),
        );

        await expect(
            withProfileUpdateCapacity(eventWithResponse().event, 400, async () => "fast"),
        ).resolves.toBe("fast");

        release.resolve();
        await Promise.all(slow);
    });

    it("disables the deadline when the configured value is zero", async () => {
        vi.stubEnv("PROFILE_UPDATE_DEADLINE_MS", "0");

        await expect(
            withProfileUpdateCapacity(eventWithResponse().event, 81, async () => "saved"),
        ).resolves.toBe("saved");
    });

    it("releases capacity when the operation throws synchronously", async () => {
        const failure = new Error("body read failed");

        await expect(
            withProfileUpdateCapacity(eventWithResponse().event, 82, (() => {
                throw failure;
            }) as never),
        ).rejects.toBe(failure);

        await expect(
            withProfileUpdateCapacity(eventWithResponse().event, 82, async () => "retried"),
        ).resolves.toBe("retried");
    });

    it("does not decrement capacity twice when a timed-out operation later settles", async () => {
        vi.stubEnv("PROFILE_UPDATE_DEADLINE_MS", "5");
        const late = deferred<string>();

        await expect(
            withProfileUpdateCapacity(eventWithResponse().event, 83, () => late.promise),
        ).rejects.toMatchObject({ statusCode: 408 });

        late.resolve("late");
        await late.promise;
        await Promise.resolve();

        await expect(
            withProfileUpdateCapacity(eventWithResponse().event, 83, async () => "next"),
        ).resolves.toBe("next");
        await expect(
            withProfileUpdateCapacity(eventWithResponse().event, 84, async () => "other user"),
        ).resolves.toBe("other user");
    });

    it("restores a counter that still has another in-flight update", async () => {
        // The single-flight cap prevents this count; simulate the defensive state.
        const gate = deferred<string>();
        const running = withProfileUpdateCapacity(
            eventWithResponse().event,
            91,
            () => gate.promise,
        );
        const originalGet = Map.prototype.get;
        Map.prototype.get = function get(key: unknown) {
            if (key === 91) return 2;
            return originalGet.call(this, key);
        };
        try {
            gate.resolve("done");
            await expect(running).resolves.toBe("done");
        } finally {
            Map.prototype.get = originalGet;
        }

        await expect(
            withProfileUpdateCapacity(eventWithResponse().event, 91, async () => "blocked"),
        ).rejects.toMatchObject({ statusCode: 503 });
    });

    it("treats a missing counter as one in-flight update during release", async () => {
        // Simulate the defensive missing-entry accounting path.
        const gate = deferred<string>();
        const running = withProfileUpdateCapacity(
            eventWithResponse().event,
            92,
            () => gate.promise,
        );
        const originalGet = Map.prototype.get;
        Map.prototype.get = function get(key: unknown) {
            if (key === 92) return undefined;
            return originalGet.call(this, key);
        };
        try {
            gate.resolve("done");
            await expect(running).resolves.toBe("done");
        } finally {
            Map.prototype.get = originalGet;
        }

        await expect(
            withProfileUpdateCapacity(eventWithResponse().event, 92, async () => "available"),
        ).resolves.toBe("available");
    });
});
