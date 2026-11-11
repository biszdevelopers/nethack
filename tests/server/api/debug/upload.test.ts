import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const routeSource = readFileSync(
    resolve(
        import.meta.dirname,
        "..",
        "..",
        "..",
        "..",
        "server",
        "api",
        "debug",
        "upload.post.ts",
    ),
    "utf-8",
);
const parserSource = readFileSync(
    resolve(import.meta.dirname, "..", "..", "..", "..", "server", "utils", "multipart-upload.ts"),
    "utf-8",
);

describe("debug upload endpoint", () => {
    it("requires permission and checks cookie-authenticated requests for same-origin", () => {
        expect(routeSource).toContain('import { requireUser } from "~~/server/utils/auth"');
        expect(routeSource).toContain(
            "await requireUser(event, NethackPermissions.Debug.filesWrite)",
        );
        expect(routeSource).toContain("enforceSameOriginCookieRequest(event)");
    });

    it("streams one bounded file part and limits parser metadata", () => {
        expect(parserSource).toContain("fields: 0");
        expect(parserSource).toContain("files: 1");
        expect(parserSource).toContain("parts: 2");
        expect(parserSource).toContain("MAX_DEBUG_UPLOAD_BYTES + 1");
        expect(parserSource).toContain("createAssetFromStream(");
    });

    it("whitelists passive file extensions and rejects active SVG content", () => {
        expect(parserSource).toContain("ALLOWED_EXTENSIONS");
        expect(parserSource).toContain("ALLOWED_EXTENSIONS.has(extension)");
        expect(parserSource).not.toMatch(/\"\.svg\"/);
    });
});
