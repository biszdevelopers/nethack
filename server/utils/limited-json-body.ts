import type { H3Event } from "h3";
import { createError } from "h3";

function stopOversizedRequest(event: H3Event): void {
    const { req, res } = event.node;
    req.pause();
    if (res && !res.headersSent) {
        res.setHeader("Connection", "close");
        return;
    }
    req.destroy();
}

/** Read a request body without letting an untrusted stream grow in memory. */
export async function readLimitedRequestBody(event: H3Event, maxBytes: number): Promise<Buffer> {
    const request = event.node.req;
    if (request.headers["content-encoding"] && request.headers["content-encoding"] !== "identity") {
        stopOversizedRequest(event);
        throw createError({ statusCode: 415, statusMessage: "Unsupported Content Encoding" });
    }

    const contentLengthHeader = request.headers["content-length"];
    const contentLength =
        typeof contentLengthHeader === "string" ? Number(contentLengthHeader) : undefined;

    if (
        contentLength !== undefined &&
        (!Number.isSafeInteger(contentLength) || contentLength < 0 || contentLength > maxBytes)
    ) {
        stopOversizedRequest(event);
        throw createError({ statusCode: 413, statusMessage: "Payload Too Large" });
    }

    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let bytesRead = 0;
        let settled = false;

        const cleanup = () => {
            request.removeListener("data", onData);
            request.removeListener("end", onEnd);
            request.removeListener("error", onError);
            request.removeListener("close", cleanup);
        };

        const onData = (chunk: Buffer | string) => {
            const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            bytesRead += data.byteLength;
            if (bytesRead > maxBytes) {
                settled = true;
                request.removeListener("data", onData);
                request.removeListener("end", onEnd);
                stopOversizedRequest(event);
                request.once("close", cleanup);
                reject(createError({ statusCode: 413, statusMessage: "Payload Too Large" }));
                return;
            }
            chunks.push(data);
        };

        const onEnd = () => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(Buffer.concat(chunks, bytesRead));
        };

        const onError = (error: Error) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(error);
        };

        request.on("data", onData);
        request.once("end", onEnd);
        request.once("error", onError);
        request.once("close", cleanup);
    });
}

/** Read and parse a JSON request without letting an untrusted stream grow in memory. */
export async function readLimitedJsonBody(event: H3Event, maxBytes: number): Promise<unknown> {
    const rawBody = await readLimitedRequestBody(event, maxBytes);
    try {
        return JSON.parse(rawBody.toString("utf8"));
    } catch {
        throw createError({ statusCode: 400, statusMessage: "Invalid JSON request body" });
    }
}
