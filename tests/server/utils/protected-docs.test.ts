import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NethackPermissions } from "~~/shared/permissions";
import { readProtectedDocsFile, serveProtectedDocsFile } from "~~/server/utils/protected-docs";

vi.mock("node:path", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:path")>();
    return {
        ...actual,
        // Simulate a candidate that resolves outside the docs root.
        relative: (from: string, to: string) =>
            to.endsWith("escaped.html") ? to : actual.relative(from, to),
    };
});

const mockedRequireUser = vi.fn();
let workingDirectory: string;
let cwdSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    workingDirectory = mkdtempSync(join(tmpdir(), "nethack-private-docs-"));
    mkdirSync(join(workingDirectory, "docs", "guide"), { recursive: true });
    mkdirSync(join(workingDirectory, "docs", "assets"), { recursive: true });
    writeFileSync(
        join(workingDirectory, "docs", "index.html"),
        '<main>docs home</main><script>window.ready = true</script><script src="/docs/app.js"></script>',
    );
    writeFileSync(join(workingDirectory, "docs", "guide", "start.html"), "<h1>Guide</h1>");
    writeFileSync(join(workingDirectory, "docs", "assets", "app.js"), "console.log('docs');");
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(workingDirectory);
    mockedRequireUser.mockReset().mockResolvedValue({ id: 5, is_admin: 1 });
    vi.stubGlobal("requireUser", mockedRequireUser);
});

afterEach(() => {
    vi.unstubAllGlobals();
    cwdSpy.mockRestore();
    rmSync(workingDirectory, { recursive: true, force: true });
});

describe("private VitePress file serving", () => {
    it("serves the root page to judges and admins only", async () => {
        const event = { context: { cspNonce: "test-nonce" } } as never;

        const response = await readProtectedDocsFile(event, "");

        expect(response.body.toString()).toContain(
            '<script nonce="test-nonce">window.ready = true</script>',
        );
        expect(response.body.toString()).toContain(
            '<script nonce="test-nonce" src="/docs/app.js"></script>',
        );
        expect(response.contentType).toBe("text/html; charset=utf-8");
        expect(mockedRequireUser).toHaveBeenCalledWith(
            event,
            NethackPermissions.Judging.assignmentsRead,
        );
    });

    it("serves clean VitePress URLs and binary assets through the same permission check", async () => {
        const event = { context: {} } as never;

        await expect(readProtectedDocsFile(event, "guide/start")).resolves.toMatchObject({
            contentType: "text/html; charset=utf-8",
        });
        await expect(readProtectedDocsFile(event, "assets/app.js")).resolves.toMatchObject({
            contentType: "text/javascript; charset=utf-8",
        });
        expect(mockedRequireUser).toHaveBeenCalledTimes(2);
    });

    it("sets private response headers consistently for protected docs", async () => {
        const setHeader = vi.fn();
        const event = { context: {}, node: { res: { setHeader } } } as never;

        const body = await serveProtectedDocsFile(event, "");

        expect(body.toString()).toContain("docs home");
        expect(setHeader).toHaveBeenCalledWith("Content-Type", "text/html; charset=utf-8");
        expect(setHeader).toHaveBeenCalledWith("Cache-Control", "private, no-store");
        expect(setHeader).toHaveBeenCalledWith("X-Content-Type-Options", "nosniff");
    });

    it.each(["../private.txt", "%2e%2e%2fprivate.txt", "assets\\..\\private.txt"])(
        "rejects traversal path %s",
        async (path) => {
            await expect(
                readProtectedDocsFile({ context: {} } as never, path),
            ).rejects.toMatchObject({
                statusCode: 404,
            });
        },
    );

    it("authorizes before looking up a file", async () => {
        const denied = Object.assign(new Error("Forbidden"), { statusCode: 403 });
        mockedRequireUser.mockRejectedValueOnce(denied);

        await expect(
            readProtectedDocsFile({ context: {} } as never, "does-not-exist.html"),
        ).rejects.toBe(denied);
    });

    it("returns 404 for malformed percent-encoding", async () => {
        await expect(
            readProtectedDocsFile({ context: {} } as never, "%E0%A4%A"),
        ).rejects.toMatchObject({ statusCode: 404 });
    });

    it("returns 404 when no candidate file exists", async () => {
        await expect(
            readProtectedDocsFile({ context: {} } as never, "missing-page"),
        ).rejects.toMatchObject({ statusCode: 404 });
    });

    it("returns 503 when no built documentation directory is available", async () => {
        const emptyDirectory = mkdtempSync(join(tmpdir(), "nethack-no-docs-"));
        cwdSpy.mockReturnValue(emptyDirectory);

        try {
            await expect(readProtectedDocsFile({ context: {} } as never, "")).rejects.toMatchObject(
                { statusCode: 503 },
            );
        } finally {
            rmSync(emptyDirectory, { recursive: true, force: true });
        }
    });

    it("serves unknown extensions as an opaque binary stream", async () => {
        writeFileSync(join(workingDirectory, "docs", "assets", "data.bin"), "binary");

        const response = await readProtectedDocsFile({ context: {} } as never, "assets/data.bin");

        expect(response.contentType).toBe("application/octet-stream");
        expect(response.body.toString()).toBe("binary");
    });

    it("skips a candidate that resolves outside the docs root", async () => {
        await expect(
            readProtectedDocsFile({ context: {} } as never, "escaped.html"),
        ).rejects.toMatchObject({ statusCode: 404 });
    });

    it("does not serve files that link outside the docs root", async () => {
        const outsideDirectory = mkdtempSync(join(tmpdir(), "nethack-outside-docs-"));
        writeFileSync(join(outsideDirectory, "escape.html"), "secret");
        symlinkSync(outsideDirectory, join(workingDirectory, "docs", "link"), "junction");

        try {
            await expect(
                readProtectedDocsFile({ context: {} } as never, "link/escape.html"),
            ).rejects.toMatchObject({ statusCode: 404 });
        } finally {
            rmSync(join(workingDirectory, "docs", "link"), { recursive: true, force: true });
            rmSync(outsideDirectory, { recursive: true, force: true });
        }
    });
});
