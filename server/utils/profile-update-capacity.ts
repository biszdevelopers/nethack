import type { H3Event } from "h3";
import { createError } from "h3";

/** Keep one large profile body and its decoded image buffers live per app process. */
export const MAX_IN_FLIGHT_PROFILE_UPDATES = 1;

let inFlightProfileUpdates = 0;

/** Reject excess profile updates before buffering their potentially large request bodies. */
export async function withProfileUpdateCapacity<T>(
    event: Pick<H3Event, "node">,
    operation: () => Promise<T>,
): Promise<T> {
    if (inFlightProfileUpdates >= MAX_IN_FLIGHT_PROFILE_UPDATES) {
        event.node.res.setHeader("Retry-After", "2");
        throw createError({
            statusCode: 503,
            statusMessage: "Profile updates are temporarily busy",
            message: "Profile updates are temporarily busy. Please retry in a moment.",
        });
    }

    inFlightProfileUpdates += 1;
    try {
        return await operation();
    } finally {
        inFlightProfileUpdates -= 1;
    }
}
