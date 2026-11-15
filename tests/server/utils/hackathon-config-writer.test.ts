import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fsMock = vi.hoisted(() => ({
    readFile: vi.fn(),
    writeFile: vi.fn(),
    rename: vi.fn(),
    stat: vi.fn(),
}));

vi.mock("node:fs/promises", async (importOriginal) => ({
    ...(await importOriginal<typeof import("node:fs/promises")>()),
    ...fsMock,
}));

const { getLocalHackathonConfigPath, readHackathonConfig, writeHackathonConfig } =
    await import("~~/server/utils/hackathon-config");

const manifest = `# keep this organizer note
id: 1
status: in_progress
voting_enabled: 0
results_published: 0
show_scores: 0
show_ranking: 0
submitted_count: 0
max_votes_per_user: 0
judging_open: 0
schedule_start: null
schedule_end: null
start_timestamp: 0
end_timestamp: 0
voting_start_timestamp: 0
voting_end_timestamp: 0
results_open_timestamp: 0
theme_name: null
theme_description: null
`;

beforeEach(() => {
    vi.stubEnv("YAML_SOURCE_HACKATHON", "local");
    vi.stubEnv("HACKATHON_CONFIG_PATH", "/tmp/basishacks/HACKATHON.yml");
    fsMock.readFile.mockResolvedValue(manifest);
    fsMock.writeFile.mockResolvedValue(undefined);
    fsMock.rename.mockResolvedValue(undefined);
});

afterEach(() => {
    vi.unstubAllEnvs();
    for (const mock of Object.values(fsMock)) mock.mockReset();
});

describe("local manifest writes", () => {
    it("rejects writes when the configured source is not the local checkout", () => {
        vi.stubEnv("YAML_SOURCE_HACKATHON", "https://assets.example.test/HACKATHON.yml");

        let error: unknown;
        try {
            writeHackathonConfig({ status: "voting" });
        } catch (caught) {
            error = caught;
        }
        expect(error).toMatchObject({ statusCode: 409 });
        expect(fsMock.writeFile).not.toHaveBeenCalled();
    });

    it("refuses settings the portal must never rewrite", async () => {
        await expect(writeHackathonConfig({ rubric: {} })).rejects.toMatchObject({
            statusCode: 400,
        });
        expect(fsMock.writeFile).not.toHaveBeenCalled();
    });

    it("reports a missing local manifest", async () => {
        fsMock.readFile.mockRejectedValueOnce(new Error("ENOENT"));

        await expect(writeHackathonConfig({ status: "voting" })).rejects.toMatchObject({
            statusCode: 503,
        });
        expect(fsMock.writeFile).not.toHaveBeenCalled();
    });

    it("refuses a change that would make the manifest invalid", async () => {
        await expect(writeHackathonConfig({ status: "bogus" })).rejects.toMatchObject({
            statusCode: 409,
        });
        expect(fsMock.writeFile).not.toHaveBeenCalled();
    });

    it("reports an unwritable manifest", async () => {
        fsMock.writeFile.mockRejectedValueOnce(new Error("EACCES"));

        await expect(writeHackathonConfig({ status: "voting" })).rejects.toMatchObject({
            statusCode: 503,
        });
    });

    it("keeps comments and the rubric while replacing the requested settings", async () => {
        await writeHackathonConfig({ status: "voting", theme_name: "Beneath The Surface" });

        expect(fsMock.writeFile).toHaveBeenCalledTimes(1);
        const [temporary, contents] = fsMock.writeFile.mock.calls[0]!;
        expect(temporary).toBe(`${getLocalHackathonConfigPath()}.${process.pid}.tmp`);
        expect(contents).toContain("# keep this organizer note");
        expect(contents).toContain("judging_open: 0");
        expect(contents).toContain("Beneath The Surface");
        expect(fsMock.rename).toHaveBeenCalledWith(temporary, getLocalHackathonConfigPath());
    });

    it("invalidates the read cache so the next read reflects the write", async () => {
        fsMock.stat.mockResolvedValueOnce({ size: manifest.length, mtimeMs: 1 });
        await expect(readHackathonConfig()).resolves.toMatchObject({ status: "in_progress" });

        await writeHackathonConfig({ status: "voting" });
        const written = fsMock.writeFile.mock.calls[0]![1] as string;
        fsMock.stat.mockResolvedValueOnce({ size: written.length, mtimeMs: 2 });
        fsMock.readFile.mockResolvedValueOnce(written);

        await expect(readHackathonConfig()).resolves.toMatchObject({ status: "voting" });
    });

    it("re-reads the manifest after it is rewritten in place", async () => {
        fsMock.stat.mockResolvedValue({ size: manifest.length, mtimeMs: 3 });
        await readHackathonConfig();
        fsMock.stat.mockResolvedValue({ size: manifest.length, mtimeMs: 4 });
        fsMock.readFile.mockResolvedValueOnce(manifest.replace("in_progress", "finished"));

        await expect(readHackathonConfig()).resolves.toMatchObject({ status: "finished" });
    });

    it("uses the default path when none is configured", () => {
        vi.stubEnv("HACKATHON_CONFIG_PATH", "");

        expect(getLocalHackathonConfigPath()).toBe("HACKATHON.yml");
    });
});
