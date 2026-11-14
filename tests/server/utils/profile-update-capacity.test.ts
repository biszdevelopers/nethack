import { describe, expect, it, vi } from "vitest";
import {
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
    it("bounds profile request buffering to one in-flight update and returns retry guidance", async () => {
        expect(MAX_IN_FLIGHT_PROFILE_UPDATES).toBe(1);

        const firstStarted = deferred();
        const finishFirst = deferred();
        const firstEvent = eventWithResponse();
        const first = withProfileUpdateCapacity(firstEvent.event, async () => {
            firstStarted.resolve();
            await finishFirst.promise;
            return "complete";
        });
        await firstStarted.promise;

        const secondEvent = eventWithResponse();
        const secondOperation = vi.fn(async () => "must not run");
        await expect(
            withProfileUpdateCapacity(secondEvent.event, secondOperation),
        ).rejects.toMatchObject({
            statusCode: 503,
            message: "Profile updates are temporarily busy. Please retry in a moment.",
        });

        expect(secondEvent.setHeader).toHaveBeenCalledWith("Retry-After", "2");
        expect(secondOperation).not.toHaveBeenCalled();

        finishFirst.resolve();
        await expect(first).resolves.toBe("complete");
    });

    it("releases capacity when an update fails", async () => {
        const failure = new Error("write failed");

        await expect(
            withProfileUpdateCapacity(eventWithResponse().event, async () => {
                throw failure;
            }),
        ).rejects.toBe(failure);

        await expect(
            withProfileUpdateCapacity(eventWithResponse().event, async () => "available"),
        ).resolves.toBe("available");
    });
});
