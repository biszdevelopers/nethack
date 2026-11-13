import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const files = [
    "server/api/debug/deepseek/sessions/[id]/index.get.ts",
    "server/api/debug/deepseek/sessions/[id]/index.delete.ts",
    "server/api/debug/deepseek/sessions/index.post.ts",
    "server/api/debug/deepseek/sessions/[id]/message.post.ts",
    "server/api/_webhooks/lifecycle.post.ts",
];

const allApiFiles = [
    "server/api/login.get.ts",
    "server/api/users/index.get.ts",
    "server/api/users/index.delete.ts",
    "server/api/users/[id]/index.get.ts",
    "server/api/users/[id]/index.patch.ts",
    "server/api/users/[id]/profile_picture.get.ts",
    "server/api/teams/index.post.ts",
    "server/api/teams/index.get.ts",
    "server/api/teams/[id]/index.get.ts",
    "server/api/teams/[id]/index.patch.ts",
    "server/api/teams/[id]/submit.post.ts",
    "server/api/teams/[id]/users/index.post.ts",
    "server/api/teams/[id]/users/[user]/index.delete.ts",
    "server/api/teams/[id]/scores/index.post.ts",
    "server/api/ballot/index.get.ts",
    "server/api/ballot/index.post.ts",
    "server/api/ballot/summary.get.ts",
    "server/api/seasons/active.get.ts",
    "server/api/seasons/active.patch.ts",
    "server/api/seasons/index.get.ts",
    "server/api/admin/scores.get.ts",
    "server/api/admin/teams.get.ts",
    "server/api/admin/teams.delete.ts",
    "server/api/auth/basis/callback.get.ts",
    "server/api/debug/upload.post.ts",
    "server/api/debug/files.get.ts",
    "server/api/debug/deepseek/sessions/index.post.ts",
    "server/api/debug/deepseek/sessions/[id]/index.get.ts",
    "server/api/debug/deepseek/sessions/[id]/index.delete.ts",
    "server/api/debug/deepseek/sessions/[id]/message.post.ts",
    "server/api/_webhooks/lifecycle.post.ts",
    "server/api/_webhooks/update.post.ts",
];

describe("API error messages do not leak internal details", () => {
    for (const file of files) {
        it(`${file} avoids concatenating raw error messages`, () => {
            const source = readFileSync(resolve(import.meta.dirname, "..", "..", file), "utf-8");
            expect(source).not.toMatch(/statusMessage:.*\+\s*error\.message/);
            expect(source).not.toMatch(/message:.*\+\s*e\.message/);
        });
    }

    it("webhook lifecycle throws createError instead of returning it", () => {
        const source = readFileSync(
            resolve(
                import.meta.dirname,
                "..",
                "..",
                "server",
                "api",
                "_webhooks",
                "lifecycle.post.ts",
            ),
            "utf-8",
        );
        expect(source).not.toMatch(/return createError\(/);
    });
});

describe("All API files avoid leaking error details", () => {
    for (const file of allApiFiles) {
        it(`${file} does not concatenate error.message into statusMessage`, () => {
            const source = readFileSync(resolve(import.meta.dirname, "..", "..", file), "utf-8");
            // Should not concatenate error.message or e.message into createError statusMessage
            expect(source).not.toMatch(/statusMessage:.*\+/);

            // dccallback.get.ts intentionally includes error context in message field
            // (it concatenates e.message for client debugging - known exception)
            if (file.includes("dccallback.get.ts")) return;

            // Should not concatenate error into message field
            expect(source).not.toMatch(/message:\s*.*\+\s*(error|e)\s*\.message/);
            // Should not include raw error objects in message
            expect(source).not.toMatch(/message:\s*\$\{.*(error|e)\.message/);
        });
    }
});

describe("throw createError vs return createError", () => {
    for (const file of allApiFiles) {
        it(`${file} uses throw createError not return createError`, () => {
            const source = readFileSync(resolve(import.meta.dirname, "..", "..", file), "utf-8");
            // lifecycle.post.ts uses return validationToken (valid), not return createError
            // update.post.ts intentionally uses return createError (legacy pattern)
            if (file.includes("lifecycle.post.ts") || file.includes("update.post.ts")) {
                return;
            }
            // If it uses createError, it should use throw, not return
            if (source.includes("createError")) {
                // Check that all createError uses are thrown
                const createErrorLines = source
                    .split("\n")
                    .filter((line) => line.includes("createError"));
                for (const line of createErrorLines) {
                    expect(line.trim()).not.toMatch(/^return\s+createError/);
                }
            }
        });
    }
});

describe("Failed request error responses", () => {
    it("seasons/active.get.ts uses proper statusCode and message", () => {
        const source = readFileSync(
            resolve(import.meta.dirname, "..", "..", "server", "api", "seasons", "active.get.ts"),
            "utf-8",
        );
        expect(source).toMatch(/statusCode:/);
        expect(source).toMatch(/message:/);
        expect(source).not.toMatch(/statusMessage:.+\+.*error/);
    });

    it("does not expose the unauthenticated score-compute endpoint", () => {
        expect(
            existsSync(
                resolve(
                    import.meta.dirname,
                    "..",
                    "..",
                    "server",
                    "api",
                    "scores",
                    "compute.get.ts",
                ),
            ),
        ).toBe(false);
    });

    it("teams/index.post.ts uses throw createError consistently", () => {
        const source = readFileSync(
            resolve(import.meta.dirname, "..", "..", "server", "api", "teams", "index.post.ts"),
            "utf-8",
        );
        // Both domain error cases use throw; database cleanup rethrows its original error.
        const throwCount = (source.match(/throw createError/g) || []).length;
        expect(throwCount).toBe(2);
        // Should not return createError
        expect(source).not.toMatch(/return createError/);
    });

    it("teams/[id]/submit.post.ts handles errors with throw createError", () => {
        const source = readFileSync(
            resolve(
                import.meta.dirname,
                "..",
                "..",
                "server",
                "api",
                "teams",
                "[id]",
                "submit.post.ts",
            ),
            "utf-8",
        );
        const throwCount = (source.match(/throw createError/g) || []).length;
        expect(throwCount).toBeGreaterThanOrEqual(3);
        expect(source).not.toMatch(/return createError/);
    });

    it("ballot/index.post.ts uses appropriate status codes for different errors", () => {
        const source = readFileSync(
            resolve(import.meta.dirname, "..", "..", "server", "api", "ballot", "index.post.ts"),
            "utf-8",
        );
        expect(source).toContain("409");
        expect(source).toContain("403");
    });

    it("ballot/index.get.ts uses createError for each validation check", () => {
        const source = readFileSync(
            resolve(import.meta.dirname, "..", "..", "server", "api", "ballot", "index.get.ts"),
            "utf-8",
        );
        const throwCount = (source.match(/throw createError/g) || []).length;
        expect(throwCount).toBe(3);
        expect(source).not.toMatch(/return createError/);
    });

    it("debug/upload.post.ts validates all file upload scenarios with 400/413", () => {
        const source = readFileSync(
            resolve(import.meta.dirname, "..", "..", "server", "api", "debug", "upload.post.ts"),
            "utf-8",
        );
        expect(source).toContain("400");
        expect(source).not.toMatch(/return createError/);

        const multipart = readFileSync(
            resolve(import.meta.dirname, "..", "..", "server", "utils", "multipart-upload.ts"),
            "utf-8",
        );
        expect(multipart).toContain("413");
    });
});

describe("_webhooks error patterns", () => {
    it("lifecycle.post.ts does NOT return createError", () => {
        const source = readFileSync(
            resolve(
                import.meta.dirname,
                "..",
                "..",
                "server",
                "api",
                "_webhooks",
                "lifecycle.post.ts",
            ),
            "utf-8",
        );
        expect(source).not.toMatch(/return createError\(/);
    });

    it("lifecycle.post.ts uses throw createError for invalid lifecycle", () => {
        const source = readFileSync(
            resolve(
                import.meta.dirname,
                "..",
                "..",
                "server",
                "api",
                "_webhooks",
                "lifecycle.post.ts",
            ),
            "utf-8",
        );
        expect(source).toMatch(/throw createError/);
    });

    it("lifecycle.post.ts validates clientState before processing", () => {
        const source = readFileSync(
            resolve(
                import.meta.dirname,
                "..",
                "..",
                "server",
                "api",
                "_webhooks",
                "lifecycle.post.ts",
            ),
            "utf-8",
        );
        expect(source).toContain("getMicrosoftWebhookState");
    });
});

describe("basis-auth callback errors do not leak provider internals", () => {
    it("returns a generic authentication error", () => {
        const source = readFileSync(
            resolve(
                import.meta.dirname,
                "..",
                "..",
                "server",
                "api",
                "auth",
                "basis",
                "callback.get.ts",
            ),
            "utf-8",
        );
        expect(source).toContain("Unable to complete login. Please try again.");
        expect(source).not.toMatch(/message:\s*error\.message/);
    });
});
