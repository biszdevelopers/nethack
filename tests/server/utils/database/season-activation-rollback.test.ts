import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { writeManifest } = vi.hoisted(() => ({ writeManifest: vi.fn() }));

vi.mock("~~/server/utils/hackathon-config", async (importOriginal) => {
    const actual = await importOriginal<typeof import("~~/server/utils/hackathon-config")>();
    return { ...actual, writeHackathonConfig: writeManifest };
});

import { createMockEvent } from "./helpers";
import { getActiveSeason, setActiveSeason } from "~~/server/utils/database/seasons";

describe("activation rollback with a concurrent switch", () => {
    let event: Awaited<ReturnType<typeof createMockEvent>>;
    let manifestDirectory: string;

    beforeEach(async () => {
        manifestDirectory = mkdtempSync(join(tmpdir(), "basishacks-rollback-"));
        writeFileSync(
            join(manifestDirectory, "HACKATHON.yml"),
            "id: 1\nstatus: voting\nvoting_enabled: 1\nresults_published: 0\nshow_scores: 0\nshow_ranking: 0\nsubmitted_count: 0\nmax_votes_per_user: 1\njudging_open: 1\nschedule_start: null\nschedule_end: null\nstart_timestamp: 0\nend_timestamp: 0\nvoting_start_timestamp: 0\nvoting_end_timestamp: 0\nresults_open_timestamp: 0\ntheme_name: Live\ntheme_description: Live\n",
        );
        vi.stubEnv("YAML_SOURCE_HACKATHON", "local");
        vi.stubEnv("HACKATHON_CONFIG_PATH", join(manifestDirectory, "HACKATHON.yml"));
        event = await createMockEvent();
        event.context.drizzle
            .prepare(
                "INSERT INTO hackathon(id, status, start_timestamp, end_timestamp, voting_start_timestamp, voting_end_timestamp, results_open_timestamp, theme_name) VALUES(1, 'voting', 0, 0, 0, 0, 0, 'Live')",
            )
            .run();
        event.context.drizzle
            .prepare(
                "INSERT INTO seasons(id, name, is_active, status, theme_name) VALUES(1, 'One', 1, 'voting', 'Live')",
            )
            .run();
        event.context.drizzle
            .prepare(
                "INSERT INTO seasons(id, name, is_active, status, theme_name, theme_description, voting_enabled, start_timestamp, end_timestamp, voting_start_timestamp, voting_end_timestamp, results_open_timestamp) VALUES(2, 'Two', 0, 'voting', 'Two', 'Two desc', 1, 1, 2, 3, 4, 5)",
            )
            .run();
        event.context.drizzle
            .prepare(
                "INSERT INTO seasons(id, name, is_active, status) VALUES(3, 'Three', 0, 'voting')",
            )
            .run();
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.clearAllMocks();
        rmSync(manifestDirectory, { recursive: true, force: true });
    });

    it("skips rollback when no season is active after the failed write", async () => {
        writeManifest.mockImplementationOnce(async () => {
            event.context.drizzle.prepare("UPDATE seasons SET is_active = 0").run();
            throw new Error("manifest write failed");
        });

        await expect(setActiveSeason(event, 2)).rejects.toThrow("manifest write failed");
        const active = await getActiveSeason(event);
        expect(active).toBeNull();
    });

    it("does not restore stale state when another instance activated a newer season", async () => {
        writeManifest.mockImplementationOnce(async () => {
            event.context.drizzle.prepare("UPDATE seasons SET is_active = 0 WHERE id = 2").run();
            event.context.drizzle.prepare("UPDATE seasons SET is_active = 1 WHERE id = 3").run();
            throw new Error("manifest write failed");
        });

        await expect(setActiveSeason(event, 2)).rejects.toThrow("manifest write failed");
        expect(await getActiveSeason(event)).toMatchObject({ id: 3 });
    });
});
