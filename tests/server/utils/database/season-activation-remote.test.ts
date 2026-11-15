import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockEvent } from "./helpers";
import { getActiveSeason, setActiveSeason } from "~~/server/utils/database/seasons";

const mocks = vi.hoisted(() => ({ write: vi.fn() }));

vi.mock("~~/server/utils/hackathon-config", async (importOriginal) => {
    const actual = await importOriginal<typeof import("~~/server/utils/hackathon-config")>();
    return {
        ...actual,
        getHackathonConfigSource: () => "remote",
        hackathonUsesYaml: () => true,
        readHackathonConfig: async () => ({
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
        }),
        writeHackathonConfig: mocks.write,
    };
});

describe("setActiveSeason with a remote manifest", () => {
    let event: Awaited<ReturnType<typeof createMockEvent>>;

    beforeEach(async () => {
        event = await createMockEvent();
        event.context.drizzle
            .prepare(
                "INSERT INTO hackathon(id, status, start_timestamp, end_timestamp, voting_start_timestamp, voting_end_timestamp, results_open_timestamp) VALUES(1, 'voting', 0, 0, 0, 0, 0)",
            )
            .run();
        event.context.drizzle
            .prepare(
                "INSERT INTO seasons(name, is_active, status, voting_enabled, judging_open, theme_name) VALUES('Current', 1, 'voting', 1, 1, 'Remote theme')",
            )
            .run();
        event.context.drizzle
            .prepare(
                "INSERT INTO seasons(name, is_active, status, voting_enabled, judging_open, theme_name) VALUES('Next', 0, 'finished', 0, 0, 'Next theme')",
            )
            .run();
    });

    it("applies the target's operational switches without writing the manifest", async () => {
        await setActiveSeason(event, 2);

        expect(mocks.write).not.toHaveBeenCalled();
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
    });
});
