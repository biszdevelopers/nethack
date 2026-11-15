import { describe, expect, it, vi } from "vitest";
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
