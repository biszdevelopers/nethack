import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockEvent } from "./helpers";
import {
    getActiveSeason,
    getScoreRankVisibilityResolver,
    setActiveSeason,
} from "~~/server/utils/database/seasons";

const manifest = vi.hoisted(() => ({ reads: 0 }));

const remoteConfig = {
    id: 1,
    status: "voting",
    voting_enabled: 1,
    results_published: 0,
    submitted_count: 0,
    max_votes_per_user: 1,
    judging_open: 1,
    schedule_start: null,
    schedule_end: null,
    start_timestamp: 0,
    end_timestamp: 0,
    voting_start_timestamp: 0,
    voting_end_timestamp: 0,
    results_open_timestamp: 0,
    theme_name: "Remote theme",
    theme_description: "Remote description",
};

vi.mock("~~/server/utils/hackathon-config", async (importOriginal) => {
    const actual = await importOriginal<typeof import("~~/server/utils/hackathon-config")>();
    return {
        ...actual,
        getHackathonConfigSource: () => "remote",
        hackathonUsesYaml: () => true,
        readHackathonConfig: async () => {
            manifest.reads += 1;
            if (manifest.reads === 2) throw new Error("remote manifest unavailable");
            return remoteConfig;
        },
        writeHackathonConfig: vi.fn(),
    };
});

describe("setActiveSeason when the manifest cannot be read", () => {
    let event: Awaited<ReturnType<typeof createMockEvent>>;

    beforeEach(async () => {
        manifest.reads = 0;
        event = await createMockEvent();
        event.context.drizzle
            .prepare(
                "INSERT INTO hackathon(id, status, start_timestamp, end_timestamp, voting_start_timestamp, voting_end_timestamp, results_open_timestamp) VALUES(1, 'voting', 0, 0, 0, 0, 0)",
            )
            .run();
        event.context.drizzle
            .prepare(
                "INSERT INTO seasons(name, is_active, status, voting_enabled, judging_open, theme_name) VALUES('Current', 1, 'voting', 1, 1, 'Current theme')",
            )
            .run();
        event.context.drizzle
            .prepare(
                "INSERT INTO seasons(name, is_active, status, voting_enabled, judging_open, theme_name) VALUES('Next', 0, 'finished', 0, 0, 'Next theme')",
            )
            .run();
    });

    it("still activates the target season with no manifest-derived overrides", async () => {
        await expect(setActiveSeason(event, 2)).resolves.toBeUndefined();

        const active = await getActiveSeason(event);
        expect(active).toMatchObject({
            id: 2,
            name: "Next",
            status: "finished",
            voting_enabled: 0,
            judging_open: 0,
        });
        const row = event.context.drizzle
            .prepare("SELECT live_overrides FROM hackathon WHERE id = 1")
            .first() as { live_overrides: string };
        expect(JSON.parse(row.live_overrides)).toMatchObject({
            status: "finished",
            voting_enabled: 0,
            judging_open: 0,
        });
        expect(manifest.reads).toBeGreaterThanOrEqual(2);
    });

    it("resolves score and rank visibility from stored seasons in YAML mode", async () => {
        const resolver = await getScoreRankVisibilityResolver(event);

        expect(resolver(2)).toEqual({
            resultsPublished: false,
            showScores: false,
            showRanking: false,
        });
        expect(resolver(999)).toEqual({
            resultsPublished: false,
            showScores: false,
            showRanking: false,
        });
    });
});
