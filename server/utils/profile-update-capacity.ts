import type { H3Event } from "h3";
import { createError } from "h3";

/** One large profile body per user at a time. */
export const MAX_IN_FLIGHT_PROFILE_UPDATES = 1;
/** Process-wide ceiling; leaves room for several users' slow uploads at once. */
export const MAX_CONCURRENT_PROFILE_UPDATES = 16;
/** Default body-read deadline for one profile update. */
export const PROFILE_UPDATE_DEADLINE_MS = 30_000;

const inFlightByUser = new Map<number, number>();
let inFlightTotal = 0;

function updateDeadlineMs(): number {
    const configured = Number(process.env.PROFILE_UPDATE_DEADLINE_MS);
    if (configured === 0) return 0;
    return Number.isSafeInteger(configured) && configured > 0
        ? configured
        : PROFILE_UPDATE_DEADLINE_MS;
}

/** Reject excess profile updates before buffering their potentially large request bodies. */
export async function withProfileUpdateCapacity<T>(
    event: Pick<H3Event, "node">,
    userID: number,
    operation: () => Promise<T>,
): Promise<T> {
    const current = inFlightByUser.get(userID) ?? 0;
    if (
        current >= MAX_IN_FLIGHT_PROFILE_UPDATES ||
        inFlightTotal >= MAX_CONCURRENT_PROFILE_UPDATES
    ) {
        event.node.res.setHeader("Retry-After", "2");
        throw createError({
            statusCode: 503,
            statusMessage: "Profile updates are temporarily busy",
            message: "Profile updates are temporarily busy. Please retry in a moment.",
        });
    }

    inFlightByUser.set(userID, current + 1);
    inFlightTotal += 1;
    let released = false;
    const release = () => {
        if (released) return;
        released = true;
        const remaining = (inFlightByUser.get(userID) ?? 1) - 1;
        if (remaining <= 0) inFlightByUser.delete(userID);
        else inFlightByUser.set(userID, remaining);
        inFlightTotal -= 1;
    };

    let deadline: ReturnType<typeof setTimeout> | undefined;
    const timeoutMs = updateDeadlineMs();
    const expiry = new Promise<never>((_resolve, reject) => {
        if (timeoutMs <= 0) return;
        deadline = setTimeout(() => {
            reject(
                createError({
                    statusCode: 408,
                    statusMessage: "Request Timeout",
                    message: "The profile update body was not received in time.",
                }),
            );
        }, timeoutMs);
        deadline.unref?.();
    });

    let guarded: Promise<T>;
    try {
        guarded = operation().finally(release);
    } catch (error) {
        release();
        throw error;
    }

    try {
        return await Promise.race([guarded, expiry]);
    } catch (error) {
        // A timed-out read releases its slot; the abandoned socket is closed by
        // the runtime and must not hold capacity for other users.
        if ((error as { statusCode?: number }).statusCode === 408) release();
        throw error;
    } finally {
        if (deadline) clearTimeout(deadline);
    }
}
