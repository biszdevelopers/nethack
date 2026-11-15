import { mkdir, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fsMock = vi.hoisted(() => ({
    stat: vi.fn(),
    readFile: vi.fn(),
    actual: {} as typeof import("node:fs/promises"),
}));
vi.mock("node:fs/promises", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:fs/promises")>();
    fsMock.actual = actual;
    return { ...actual, stat: fsMock.stat, readFile: fsMock.readFile };
});
const { fetch } = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("node-fetch", () => ({ default: fetch }));

const { getHackathonCacheFile, readHackathonConfig } =
    await import("~~/server/utils/hackathon-config");

let cacheFile = "";
let cacheDir = "";

function useRealFileSystem() {
    fsMock.stat.mockImplementation(fsMock.actual.stat!);
    fsMock.readFile.mockImplementation(fsMock.actual.readFile!);
}

beforeEach(() => {
    cacheDir = join(tmpdir(), `basishacks-hackathon-storage-${randomUUID()}`);
    cacheFile = join(cacheDir, "hackathon.yml");
    vi.stubEnv("HACKATHON_CACHE_PATH", cacheFile);
    useRealFileSystem();
});

afterEach(async () => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    fetch.mockReset();
    fsMock.stat.mockReset();
    fsMock.readFile.mockReset();
    await rm(cacheDir, { recursive: true, force: true });
});

describe("hackathon manifest storage limits", () => {
    it("rejects a local manifest above the size limit", async () => {
        vi.stubEnv("YAML_SOURCE_HACKATHON", "local");
        fsMock.stat.mockResolvedValueOnce({ size: 70_000, mtimeMs: 1 });

        await expect(readHackathonConfig()).rejects.toMatchObject({ statusCode: 503 });
    });

    it("rejects local manifest bytes above the size limit", async () => {
        vi.stubEnv("YAML_SOURCE_HACKATHON", "local");
        fsMock.stat.mockResolvedValueOnce({ size: 10, mtimeMs: 2 });
        fsMock.readFile.mockResolvedValueOnce(Buffer.alloc(70_000));

        await expect(readHackathonConfig()).rejects.toMatchObject({ statusCode: 503 });
    });

    it("rejects an unreadable local manifest", async () => {
        vi.stubEnv("YAML_SOURCE_HACKATHON", "local");
        fsMock.stat.mockRejectedValueOnce(new Error("EACCES"));

        await expect(readHackathonConfig()).rejects.toMatchObject({ statusCode: 503 });
    });

    it("rejects an unavailable remote manifest with no cached or bundled fallback", async () => {
        vi.stubEnv("YAML_SOURCE_HACKATHON", "https://assets.example.test/missing.yml");
        fetch.mockRejectedValueOnce(new Error("offline"));
        fsMock.readFile.mockRejectedValueOnce(new Error("ENOENT"));
        fsMock.stat.mockRejectedValueOnce(new Error("EACCES"));

        await expect(readHackathonConfig()).rejects.toMatchObject({ statusCode: 503 });
    });

    it("ignores an oversized cached manifest and reports the outage", async () => {
        vi.stubEnv("YAML_SOURCE_HACKATHON", "https://assets.example.test/oversized.yml");
        await mkdir(cacheDir, { recursive: true });
        await writeFile(cacheFile, Buffer.alloc(70_000));
        fetch.mockRejectedValueOnce(new Error("offline"));
        fsMock.stat.mockRejectedValueOnce(new Error("EACCES"));

        await expect(readHackathonConfig()).rejects.toMatchObject({ statusCode: 503 });
    });

    it.each([
        ["embedded credentials", "https://user:secret@assets.example.test/HACKATHON.yml"],
        ["a fragment", "https://assets.example.test/HACKATHON.yml#section"],
        ["plain HTTP outside development", "http://assets.example.test/HACKATHON.yml"],
    ])("refuses a remote source with %s", async (_name, source) => {
        vi.stubEnv("YAML_SOURCE_HACKATHON", source);
        vi.stubEnv("NODE_ENV", source.startsWith("http:") ? "production" : "test");

        await expect(readHackathonConfig()).rejects.toMatchObject({ statusCode: 503 });
        expect(fetch).not.toHaveBeenCalled();
    });

    it("uses the default cache path when none is configured", () => {
        vi.stubEnv("HACKATHON_CACHE_PATH", "");

        expect(getHackathonCacheFile().replaceAll("\\", "/")).toMatch(
            /\/assets\/hackathon-config\.yml$/,
        );
    });
});
