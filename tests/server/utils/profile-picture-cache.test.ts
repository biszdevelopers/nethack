import { rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchBasisAuthPicture, getBasisAuthPictureUrl } from "~~/server/utils/profile";

const { fetch } = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("node-fetch", () => ({ default: fetch }));

let cacheDir: string;

beforeEach(() => {
    cacheDir = join(tmpdir(), `basishacks-profile-cache-${randomUUID()}`);
    vi.stubEnv("BASIS_AUTH_PICTURE_CACHE_DIR", cacheDir);
});

afterEach(async () => {
    vi.unstubAllEnvs();
    fetch.mockReset();
    await rm(cacheDir, { recursive: true, force: true });
});

describe("basis-auth profile pictures", () => {
    it("accepts only same-origin credential-free picture URLs", () => {
        expect(
            getBasisAuthPictureUrl(
                "https://auth.example.test/api/picture/1",
                "https://auth.example.test",
            ),
        ).toBe("https://auth.example.test/api/picture/1");
        expect(
            getBasisAuthPictureUrl("https://evil.example.test/a.png", "https://auth.example.test"),
        ).toBeUndefined();
        expect(
            getBasisAuthPictureUrl("https://auth.example.test/a.png", undefined),
        ).toBeUndefined();
    });

    it("caches provider bytes and serves them when the provider is unavailable", async () => {
        const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
        fetch.mockResolvedValueOnce(
            new Response(bytes, { headers: { "content-type": "image/png" } }),
        );
        await expect(
            fetchBasisAuthPicture("https://auth.example.test/api/picture/1", "1"),
        ).resolves.toEqual({ bytes, contentType: "image/png" });

        fetch.mockRejectedValueOnce(new Error("provider offline"));
        await expect(
            fetchBasisAuthPicture("https://auth.example.test/api/picture/1", "1"),
        ).resolves.toEqual({ bytes, contentType: "image/png" });
    });

    it("ignores non-image responses and unsafe cache keys", async () => {
        fetch.mockResolvedValueOnce(
            new Response(Buffer.from("not an image"), {
                headers: { "content-type": "text/plain" },
            }),
        );
        await expect(
            fetchBasisAuthPicture("https://auth.example.test/api/picture/1", "../escape"),
        ).resolves.toBeUndefined();
    });
});
