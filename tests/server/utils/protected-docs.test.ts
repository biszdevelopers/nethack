import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NethackPermissions } from "~~/shared/permissions";
import { readProtectedDocsFile, serveProtectedDocsFile } from "~~/server/utils/protected-docs";

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
});
