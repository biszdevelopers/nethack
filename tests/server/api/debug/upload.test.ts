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
    it("returns gone without invoking the multipart parser", () => {
        expect(routeSource).toContain("statusCode: 410");
        expect(routeSource).not.toContain("storeMultipartAsset");
    });

    it("streams one bounded file part and limits parser metadata", () => {
        expect(parserSource).toContain("fields: 0");
        expect(parserSource).toContain("files: 1");
        expect(parserSource).toContain("parts: 2");
        expect(parserSource).toContain("MAX_DEBUG_UPLOAD_BYTES + 1");
        expect(parserSource).toContain("stageAssetFromStream(");
        expect(parserSource).toContain("publishStagedAssetContentAddressed(");
    });

    it("whitelists passive file extensions and rejects active SVG content", () => {
        expect(parserSource).toContain("ALLOWED_EXTENSIONS");
        expect(parserSource).toContain("ALLOWED_EXTENSIONS.has(extension)");
        expect(parserSource).not.toMatch(/\"\.svg\"/);
    });
});
