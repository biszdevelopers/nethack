import { access, realpath, readFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createError, setHeader } from "h3";
import type { H3Event } from "h3";
import { NethackPermissions } from "~~/shared/permissions";

const CONTENT_TYPES: Record<string, string> = {
    ".css": "text/css; charset=utf-8",
    ".gif": "image/gif",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".txt": "text/plain; charset=utf-8",
    ".webmanifest": "application/manifest+json",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".xml": "application/xml; charset=utf-8",
};

const SCRIPT_TAG = /<script\b(?![^>]*\bnonce=)(?=[\s>])/gi;

function bindInlineScriptsToCsp(body: Buffer, nonce: string | undefined): Buffer {
    if (!nonce) return body;
    const html = body.toString("utf8").replace(SCRIPT_TAG, `<script nonce="${nonce}"`);
    return Buffer.from(html);
}

async function findDocsRoot(): Promise<string> {
    const candidates = [
        resolve(process.cwd(), "docs"),
        resolve(process.cwd(), "documentation", ".vitepress", "dist"),
    ];
    for (const candidate of candidates) {
        try {
            await access(join(candidate, "index.html"));
            return await realpath(candidate);
        } catch {
            // Check the next supported layout: source checkout or VPS release.
        }
    }
    throw createError({ statusCode: 503, message: "Documentation is not available" });
}

function isInside(root: string, target: string): boolean {
    const path = relative(root, target);
    return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
}

/** Read one built VitePress file after enforcing the judge/admin permission. */
export async function readProtectedDocsFile(
    event: H3Event,
    requestedPath: string,
): Promise<{ body: Buffer; contentType: string }> {
    await requireUser(event, NethackPermissions.Judging.assignmentsRead);

    const root = await findDocsRoot();
    let decodedPath: string;
    try {
        decodedPath = decodeURIComponent(requestedPath);
    } catch {
        throw createError({ statusCode: 404, message: "Documentation page not found" });
    }

    const normalized = decodedPath.replaceAll("\\", "/");
    if (normalized.startsWith("/") || normalized.split("/").some((part) => part === "..")) {
        throw createError({ statusCode: 404, message: "Documentation page not found" });
    }

    const cleanPath = normalized.replace(/^\/+|\/+$/g, "");
    const candidates = cleanPath
        ? [cleanPath, `${cleanPath}.html`, join(cleanPath, "index.html")]
        : ["index.html"];

    for (const relativePath of candidates) {
        const candidate = resolve(root, relativePath);
        if (!isInside(root, candidate)) continue;
        try {
            const actualPath = await realpath(candidate);
            if (!isInside(root, actualPath)) continue;
            const body = await readFile(actualPath);
            const contentType = CONTENT_TYPES[extname(actualPath).toLowerCase()];
            return {
                body: contentType?.startsWith("text/html")
                    ? bindInlineScriptsToCsp(body, event.context.cspNonce)
                    : body,
                contentType: contentType ?? "application/octet-stream",
            };
        } catch {
            // Try the next VitePress clean URL form.
        }
    }

    throw createError({ statusCode: 404, message: "Documentation page not found" });
}

/** Read and send one protected VitePress file with the cache and MIME headers used by every route. */
export async function serveProtectedDocsFile(
    event: H3Event,
    requestedPath: string,
): Promise<Buffer> {
    const { body, contentType } = await readProtectedDocsFile(event, requestedPath);
    setHeader(event, "Content-Type", contentType);
    setHeader(event, "Cache-Control", "private, no-store");
    setHeader(event, "X-Content-Type-Options", "nosniff");
    return body;
}
