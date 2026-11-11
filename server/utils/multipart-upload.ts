import Busboy from "busboy";
import { randomUUID } from "node:crypto";
import { extname } from "node:path/posix";
import type { IncomingMessage } from "node:http";
import type { Readable } from "node:stream";
import { createError } from "h3";
import { createAssetFromStream, type AssetCollection } from "./assets";

export const MAX_DEBUG_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_MULTIPART_OVERHEAD = 64 * 1024;

const ALLOWED_EXTENSIONS = new Set([
    ".gif",
    ".jpg",
    ".jpeg",
    ".json",
    ".md",
    ".mp4",
    ".pdf",
    ".png",
    ".txt",
    ".webp",
    ".zip",
]);

function uploadError(statusCode: number, statusMessage: string) {
    return createError({ statusCode, statusMessage, message: statusMessage });
}

function getPrefixValidator(extension: string): ((prefix: Buffer) => boolean) | undefined {
    const signatures: Record<string, (prefix: Buffer) => boolean> = {
        ".gif": (prefix) => prefix.subarray(0, 3).toString("ascii") === "GIF",
        ".jpeg": (prefix) => prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff,
        ".jpg": (prefix) => prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff,
        ".mp4": (prefix) => prefix.subarray(4, 8).toString("ascii") === "ftyp",
        ".pdf": (prefix) => prefix.subarray(0, 5).toString("ascii") === "%PDF-",
        ".png": (prefix) =>
            prefix.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
        ".webp": (prefix) =>
            prefix.subarray(0, 4).toString("ascii") === "RIFF" &&
            prefix.subarray(8, 12).toString("ascii") === "WEBP",
        ".zip": (prefix) => prefix[0] === 0x50 && prefix[1] === 0x4b,
    };
    return signatures[extension];
}

/** Accept exactly one file part and stream it to disk with bounded memory. */
export async function storeMultipartAsset(
    request: IncomingMessage,
    contentType: string | undefined,
    collection: AssetCollection = "assets",
): Promise<{ filename: string; relativePath: string }> {
    const rawLength = request.headers["content-length"];
    const contentLength = typeof rawLength === "string" ? Number(rawLength) : undefined;
    if (
        contentLength !== undefined &&
        (!Number.isSafeInteger(contentLength) ||
            contentLength < 0 ||
            contentLength > MAX_DEBUG_UPLOAD_BYTES + MAX_MULTIPART_OVERHEAD)
    ) {
        throw uploadError(413, "Upload request is too large");
    }

    let parser: ReturnType<typeof Busboy>;
    try {
        parser = Busboy({
            headers: { ...request.headers, "content-type": contentType },
            preservePath: false,
            highWaterMark: 32 * 1024,
            fileHwm: 32 * 1024,
            limits: {
                fieldNameSize: 64,
                fields: 0,
                fileSize: MAX_DEBUG_UPLOAD_BYTES + 1,
                files: 1,
                headerPairs: 32,
                // Busboy emits partsLimit as soon as its limit is reached, so 2 means one allowed part.
                parts: 2,
            },
        });
    } catch {
        throw uploadError(400, "A valid multipart file upload is required");
    }

    let fileSeen = false;
    let activeFileStream: Readable | undefined;
    let savedFilename: string | undefined;
    let failure: ReturnType<typeof uploadError> | undefined;
    let fileTask: Promise<void> | undefined;
    const fail = (statusCode: number, message: string) => {
        failure ??= uploadError(statusCode, message);
    };
    let requestBytes = 0;
    request.on("data", (chunk: Buffer) => {
        requestBytes += chunk.length;
        if (requestBytes > MAX_DEBUG_UPLOAD_BYTES + MAX_MULTIPART_OVERHEAD && !failure) {
            fail(413, "Upload request is too large");
            request.unpipe(parser);
            parser.destroy();
            activeFileStream?.destroy();
            request.resume();
        }
    });

    parser.on("file", (fieldName, stream, info) => {
        if (fileSeen || fieldName !== "file" || !info.filename) {
            fail(400, "Upload exactly one file using the file field");
            stream.resume();
            return;
        }
        fileSeen = true;
        activeFileStream = stream;

        const extension = extname(info.filename).toLowerCase();
        if (!ALLOWED_EXTENSIONS.has(extension)) {
            fail(400, "File extension not allowed");
            stream.resume();
            return;
        }

        const filename = `${randomUUID()}${extension}`;
        const relativePath = collection === "assets" ? `uploads/${filename}` : filename;
        stream.on("limit", () => fail(413, "File too large"));
        fileTask = createAssetFromStream(
            relativePath,
            stream,
            MAX_DEBUG_UPLOAD_BYTES,
            getPrefixValidator(extension),
            collection,
        )
            .then(() => {
                savedFilename = filename;
            })
            .catch((error: { statusCode?: number; statusMessage?: string }) => {
                failure ??= uploadError(
                    error.statusCode === 413 ? 413 : error.statusCode === 400 ? 400 : 500,
                    error.statusMessage ?? "Unable to store uploaded file",
                );
            });
    });

    parser.on("field", () => fail(400, "Upload exactly one file and no extra fields"));
    parser.on("filesLimit", () => fail(400, "Upload exactly one file"));
    parser.on("fieldsLimit", () => fail(400, "Upload exactly one file and no extra fields"));
    parser.on("partsLimit", () => fail(400, "Upload exactly one file and no extra fields"));

    const parsing = new Promise<void>((resolve, reject) => {
        parser.once("close", resolve);
        parser.once("error", reject);
        request.once("error", reject);
    });
    request.pipe(parser);

    try {
        await parsing;
    } catch {
        request.unpipe(parser);
        request.resume();
        activeFileStream?.destroy();
        await fileTask;
        if (failure) throw failure;
        throw uploadError(400, "Malformed multipart upload");
    }
    await fileTask;

    if (failure) throw failure;
    if (!fileSeen || !savedFilename) throw uploadError(400, "No file uploaded");
    return {
        filename: savedFilename,
        relativePath: collection === "assets" ? `uploads/${savedFilename}` : savedFilename,
    };
}
