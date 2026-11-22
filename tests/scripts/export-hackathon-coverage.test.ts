import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RUBRIC_DEFINITION } from "~~/shared/rubric";

const state = vi.hoisted(() => ({
    row: null as Record<string, unknown> | null,
    version: null as Record<string, unknown> | null,
    queries: [] as string[],
}));
const writeFile = vi.hoisted(() => vi.fn());
const rename = vi.hoisted(() => vi.fn());
const unlink = vi.hoisted(() => vi.fn());
const end = vi.hoisted(() => vi.fn());

vi.mock("node:fs/promises", async (importOriginal) => ({
    ...(await importOriginal<typeof import("node:fs/promises")>()),
    writeFile,
    rename,
    unlink,
}));
vi.mock("postgres", () => ({
    default: () => {
        const sql: any = async (parts: TemplateStringsArray) => {
            const query = parts.join(" ");
            state.queries.push(query);
            if (query.includes("FROM hackathon")) return state.row ? [state.row] : [];
            if (query.includes("rubric_versions")) return state.version ? [state.version] : [];
            return [];
        };
        sql.end = end;
        return sql;
    },
}));

const hackathonRow = {
    id: 1,
    status: "voting",
    voting_enabled: 0,
    results_published: 0,
    show_scores: 0,
    show_ranking: 0,
    submitted_count: 0,
    max_votes_per_user: 0,
    judging_open: 1,
    schedule_start: null,
    schedule_end: null,
    start_timestamp: "1794667462000",
    end_timestamp: "1794767462000",
    voting_start_timestamp: "1794667462000",
    voting_end_timestamp: "1794767462000",
    results_open_timestamp: "1794767462000",
    theme_name: "Beneath The Surface",
    theme_description: "There is Something beneath the surface...",
    live_overrides: { status: "finished" },
};

async function runScript(databaseUrl: string | undefined, output?: string) {
    vi.resetModules();
    state.queries = [];
    if (databaseUrl === undefined) vi.stubEnv("DATABASE_URL", "");
    else vi.stubEnv("DATABASE_URL", databaseUrl);
    process.argv = ["node", "export-hackathon.ts", ...(output ? [output] : [])];
    return await import("~~/scripts/export-hackathon");
}

beforeEach(() => {
    state.row = { ...hackathonRow };
    state.version = null;
    writeFile.mockReset().mockResolvedValue(undefined);
    rename.mockReset().mockResolvedValue(undefined);
    unlink.mockReset().mockResolvedValue(undefined);
    end.mockReset().mockResolvedValue(undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
});

afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    process.argv = ["node", "vitest"];
});

describe("hackathon manifest export script", { timeout: 30_000 }, () => {
    it("requires a PostgreSQL connection string", async () => {
        await expect(runScript(undefined)).rejects.toThrow(
            "Set DATABASE_URL before exporting the hackathon configuration.",
        );
    });

    it("refuses to export when the canonical hackathon row is missing", async () => {
        state.row = null;

        await expect(runScript("postgres://fixture@localhost/db")).rejects.toThrow(
            "PostgreSQL has no hackathon row with id 1.",
        );
        expect(writeFile).not.toHaveBeenCalled();
        expect(end).toHaveBeenCalledOnce();
    });

    it("writes a validated manifest including the active rubric", async () => {
        state.version = { name: "Imported rubric", definition: DEFAULT_RUBRIC_DEFINITION };

        await runScript("postgres://fixture@localhost/db", "exported.yml");

        expect(state.queries).toHaveLength(2);
        const [path, contents] = writeFile.mock.calls[0]!;
        expect(path).toContain("exported.yml");
        expect(path).toContain(".tmp");
        expect(rename).toHaveBeenCalledWith(path, expect.stringContaining("exported.yml"));
        expect(contents).toContain("theme_name: Beneath The Surface");
        expect(contents).toContain("name: Imported rubric");
        expect(contents).toContain("start_timestamp: 1794667462000");
        expect(contents).not.toContain("live_overrides");
        expect(end).toHaveBeenCalledOnce();
    });

    it("removes the temporary manifest when the atomic replace fails", async () => {
        rename.mockRejectedValueOnce(new Error("disk full"));
        unlink.mockRejectedValueOnce(new Error("unlink failed"));

        await expect(runScript("postgres://fixture@localhost/db", "exported.yml")).rejects.toThrow(
            "disk full",
        );

        const temporary = writeFile.mock.calls[0]![0];
        expect(unlink).toHaveBeenCalledWith(temporary);
        expect(end).toHaveBeenCalledOnce();
    });

    it("defaults the output path and omits the rubric when the season has none", async () => {
        await runScript("postgres://fixture@localhost/db");

        expect(writeFile.mock.calls[0]![0]).toContain("HACKATHON.yml");
        expect(writeFile.mock.calls[0]![1]).not.toContain("rubric:");
    });
});
