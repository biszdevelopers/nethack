import type { H3Event } from "h3";
import { createError } from "h3";

/** One large profile body per user at a time. */
export const MAX_IN_FLIGHT_PROFILE_UPDATES = 1;
/** Process-wide ceiling so many users cannot exhaust memory together. */
export const MAX_CONCURRENT_PROFILE_UPDATES = 4;

const inFlightByUser = new Map<number, number>();
let inFlightTotal = 0;

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
    try {
        return await operation();
    } finally {
        inFlightByUser.delete(userID);
        inFlightTotal -= 1;
    }
}
