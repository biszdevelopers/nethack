import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    getHackathonConfigSource,
    parseHackathonConfig,
    readHackathonConfig,
} from "~~/server/utils/hackathon-config";
import { getHackathon } from "~~/server/utils/database/hackathon";
import { getSeasons, getScoreRankVisibilityResolver } from "~~/server/utils/database/seasons";

const { fetch } = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("node-fetch", () => ({ default: fetch }));
const yaml = await readFile("HACKATHON.yml", "utf8");

afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    fetch.mockReset();
});

describe("live hackathon YAML", () => {
    it("defaults to the local file and accepts ISO timestamps and boolean flags", async () => {
        vi.stubEnv("YAML_SOURCE_HACKATHON", "");
        expect(getHackathonConfigSource()).toBe("local");
        await expect(readHackathonConfig()).resolves.toEqual(parseHackathonConfig(yaml));
        const config = parseHackathonConfig(
            yaml
                .replace(/^start_timestamp: .+$/m, "start_timestamp: 2026-06-01T09:00:00+08:00")
                .replace(/^voting_enabled: .+$/m, "voting_enabled: true"),
        );
        expect(config.start_timestamp).toBe(Date.parse("2026-06-01T09:00:00+08:00"));
        expect(config.voting_enabled).toBe(1);
    });

    it("refreshes an assets-server origin and retains the last validated manifest", async () => {
        vi.stubEnv("YAML_SOURCE_HACKATHON", "https://assets.example.test");
        vi.useFakeTimers();
        fetch.mockResolvedValueOnce(new Response(yaml, { headers: { ETag: '"v1"' } }));
        const expected = parseHackathonConfig(yaml);
        await expect(readHackathonConfig()).resolves.toEqual(expected);
        expect(fetch).toHaveBeenCalledOnce();
        expect(String(fetch.mock.calls[0]![0])).toBe("https://assets.example.test/HACKATHON.yml");

        vi.setSystemTime(Date.now() + 5 * 60 * 1000 - 1);
        await expect(readHackathonConfig()).resolves.toEqual(expected);
        expect(fetch).toHaveBeenCalledOnce();

        vi.setSystemTime(Date.now() + 1);
        fetch.mockResolvedValueOnce(new Response("status: invalid"));
        await expect(readHackathonConfig()).resolves.toEqual(expected);
        expect(fetch.mock.calls[1]![1].headers).toEqual({ "If-None-Match": '"v1"' });
    });

    it("fails closed when an explicit remote asset has no validated configuration", async () => {
        vi.stubEnv("YAML_SOURCE_HACKATHON", "https://assets.example.test/manifests/current.yml");
        fetch.mockResolvedValueOnce(new Response(null, { status: 404 }));
        await expect(readHackathonConfig()).rejects.toMatchObject({ statusCode: 503 });
        expect(String(fetch.mock.calls[0]![0])).toBe(
            "https://assets.example.test/manifests/current.yml",
        );
    });

    it("uses YAML for the active season and leaves historical settings authoritative", async () => {
        vi.stubEnv("YAML_SOURCE_HACKATHON", "https://assets.example.test/visibility.yml");
        fetch.mockResolvedValueOnce(
            new Response(
                yaml
                    .replace(/^results_published: .+$/m, "results_published: true")
                    .replace(/^show_scores: .+$/m, "show_scores: true"),
            ),
        );
        const rows = [
            {
                id: 4,
                is_active: 0,
                status: "finished",
                results_published: 1,
                show_scores: 0,
                show_ranking: 1,
            },
            {
                id: 8,
                is_active: 1,
                status: "not_started",
                results_published: 0,
                show_scores: 0,
                rubric_version_id: 9,
            },
        ];
        const event = {
            context: {
                drizzle: {
                    select: () => ({
                        from: () => ({ orderBy: async () => [...rows] }),
                    }),
                },
            },
        } as never;

        await expect(getHackathon(event)).resolves.toMatchObject({ results_published: 1 });
        const seasons = await getSeasons(event);
        expect(seasons[0]).toEqual(rows[0]);
        expect(seasons[1]).toMatchObject({
            id: 8,
            rubric_version_id: 9,
            results_published: 1,
            show_scores: 1,
        });
        const visibility = await getScoreRankVisibilityResolver(event);
        expect(visibility(8)).toMatchObject({ resultsPublished: true, showScores: true });
        expect(visibility(4)).toMatchObject({
            resultsPublished: true,
            showScores: false,
            showRanking: true,
        });
        expect(visibility(999)).toEqual({
            resultsPublished: false,
            showScores: false,
            showRanking: false,
        });
    });
});
