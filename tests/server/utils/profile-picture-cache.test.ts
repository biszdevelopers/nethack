import { mkdir, rm, utimes, writeFile } from "node:fs/promises";
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
        expect(getBasisAuthPictureUrl(42, "https://auth.example.test")).toBeUndefined();
        expect(getBasisAuthPictureUrl("not a url", "https://auth.example.test")).toBeUndefined();
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
            fetchBasisAuthPicture("https://auth.example.test/api/picture/1", "1", {
                forceRefresh: true,
            }),
        ).resolves.toEqual({ bytes, contentType: "image/png" });
    });

    it("serves a fresh cached avatar without contacting the provider", async () => {
        const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
        fetch.mockResolvedValueOnce(
            new Response(bytes, { headers: { "content-type": "image/png" } }),
        );
        await fetchBasisAuthPicture("https://auth.example.test/api/picture/1", "1");
        fetch.mockClear();

        await expect(
            fetchBasisAuthPicture("https://auth.example.test/api/picture/1", "1"),
        ).resolves.toEqual({ bytes, contentType: "image/png" });
        expect(fetch).not.toHaveBeenCalled();
    });

    it("refreshes a stale cached avatar and falls back to it when the provider is offline", async () => {
        const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
        await mkdir(cacheDir, { recursive: true });
        const path = join(cacheDir, "77.png");
        await writeFile(path, bytes);
        const old = new Date(Date.now() - 60_000);
        await utimes(path, old, old);
        fetch.mockRejectedValueOnce(new Error("provider offline"));

        await expect(
            fetchBasisAuthPicture("https://auth.example.test/a.png", "77", { maxAgeMs: 1_000 }),
        ).resolves.toEqual({ bytes, contentType: "image/png" });
        expect(fetch).toHaveBeenCalledOnce();
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

    it("replaces a stale cached format when the provider changes type", async () => {
        const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
        fetch.mockResolvedValueOnce(
            new Response(png, { headers: { "content-type": "image/png" } }),
        );
        await fetchBasisAuthPicture("https://auth.example.test/a.png", "9");

        const jpeg = Buffer.from([0xff, 0xd8, 0xff]);
        fetch.mockResolvedValueOnce(
            new Response(jpeg, { headers: { "content-type": "image/jpeg" } }),
        );
        await fetchBasisAuthPicture("https://auth.example.test/a.png", "9", {
            forceRefresh: true,
        });

        fetch.mockRejectedValueOnce(new Error("provider offline"));
        await expect(
            fetchBasisAuthPicture("https://auth.example.test/a.png", "9", {
                forceRefresh: true,
            }),
        ).resolves.toEqual({ bytes: jpeg, contentType: "image/jpeg" });
    });

    it("returns provider bytes without caching when no cache key is supplied", async () => {
        const bytes = Buffer.from([1, 2, 3]);
        fetch.mockResolvedValueOnce(
            new Response(bytes, { headers: { "content-type": "image/webp; charset=binary" } }),
        );

        await expect(fetchBasisAuthPicture("https://auth.example.test/a.webp")).resolves.toEqual({
            bytes,
            contentType: "image/webp",
        });
    });

    it("ignores responses without an image content type", async () => {
        fetch.mockResolvedValueOnce(new Response(Buffer.from([1, 2, 3])));

        await expect(
            fetchBasisAuthPicture("https://auth.example.test/a.png", "7"),
        ).resolves.toBeUndefined();
    });

    it("skips an empty cached picture file", async () => {
        await mkdir(cacheDir, { recursive: true });
        await writeFile(join(cacheDir, "42.png"), new Uint8Array());
        fetch.mockRejectedValueOnce(new Error("provider offline"));

        await expect(
            fetchBasisAuthPicture("https://auth.example.test/a.png", "42"),
        ).resolves.toBeUndefined();
    });

    it("falls back to the default cache directory", async () => {
        vi.stubEnv("BASIS_AUTH_PICTURE_CACHE_DIR", "");
        fetch.mockRejectedValueOnce(new Error("provider offline"));

        await expect(
            fetchBasisAuthPicture("https://auth.example.test/a.png", "424242"),
        ).resolves.toBeUndefined();
    });
});
