import { getPostgresClient } from "~~/server/database";

const READY_TIMEOUT_MS = 2000;

function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expiry = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("readiness timeout")), timeoutMs);
        timer.unref?.();
    });
    return Promise.race([operation, expiry]).finally(() => {
        if (timer) clearTimeout(timer);
    });
}

/** Readiness: the database answers a trivial query within the deadline. */
export default defineEventHandler(async (event) => {
    setHeader(event, "Cache-Control", "no-store");
    try {
        const client = getPostgresClient();
        await withTimeout(Promise.resolve(client`select 1`), READY_TIMEOUT_MS);
        return { status: "ok" };
    } catch {
        setResponseStatus(event, 503);
        return { status: "unavailable" };
    }
});
