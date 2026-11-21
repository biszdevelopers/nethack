import { randomUUID } from "node:crypto";

const VALID_REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;

/** Accept a bounded caller request id or generate one; echo it on the response. */
export default defineEventHandler((event) => {
    const incoming = getHeader(event, "x-request-id");
    const requestId =
        typeof incoming === "string" && VALID_REQUEST_ID.test(incoming) ? incoming : randomUUID();

    (event.context as Record<string, unknown>).requestId = requestId;
    setHeader(event, "x-request-id", requestId);
});
