import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockEvent } from "./helpers";
import { getActiveSeason, setActiveSeason } from "~~/server/utils/database/seasons";

const manifest = `# organizer note stays put
id: 1
status: voting
voting_enabled: 1
results_published: 0
show_scores: 0
show_ranking: 0
submitted_count: 0
max_votes_per_user: 1
judging_open: 1
schedule_start: null
schedule_end: null
start_timestamp: 0
end_timestamp: 0
voting_start_timestamp: 0
voting_end_timestamp: 0
results_open_timestamp: 0
theme_name: Live theme
theme_description: Live description
`;

describe("setActiveSeason with a local manifest", () => {
    let event: Awaited<ReturnType<typeof createMockEvent>>;
    let manifestDirectory: string;
    let manifestPath: string;

    beforeEach(async () => {
        manifestDirectory = mkdtempSync(join(tmpdir(), "basishacks-activation-"));
        manifestPath = join(manifestDirectory, "HACKATHON.yml");
        writeFileSync(manifestPath, manifest);
        vi.stubEnv("YAML_SOURCE_HACKATHON", "local");
        vi.stubEnv("HACKATHON_CONFIG_PATH", manifestPath);
        event = await createMockEvent();
        event.context.drizzle
            .prepare(
                "INSERT INTO hackathon(id, status, start_timestamp, end_timestamp, voting_start_timestamp, voting_end_timestamp, results_open_timestamp, theme_name) VALUES(1, 'voting', 0, 0, 0, 0, 0, 'Live theme')",
            )
            .run();
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        rmSync(manifestDirectory, { recursive: true, force: true });
    });

    function insertSeason(columns: string, values: string) {
        event.context.drizzle.prepare(`INSERT INTO seasons(${columns}) VALUES(${values})`).run();
    }

    it("writes the activated season's stored settings into the manifest", async () => {
        insertSeason(
            "name, is_active, status, theme_name, theme_description, voting_enabled",
            "'Current', 1, 'voting', 'Live theme', 'Live description', 1",
        );
        insertSeason(
            "name, is_active, status, theme_name, theme_description, voting_enabled",
            "'Archived', 0, 'finished', 'Archived theme', 'Archived description', 0",
        );

        await setActiveSeason(event, 2);

        const written = readFileSync(manifestPath, "utf8");
        expect(written).toContain("# organizer note stays put");
        expect(written).toContain("status: finished");
        expect(written).toContain("theme_name: Archived theme");
        expect(written).toContain("voting_enabled: 0");

        const active = await getActiveSeason(event);
        expect(active).toMatchObject({
            id: 2,
            name: "Archived",
            is_active: 1,
            status: "finished",
            theme_name: "Archived theme",
        });
        expect(
            event.context.drizzle
                .prepare("SELECT status, theme_name FROM hackathon WHERE id = 1")
                .first(),
        ).toEqual({ status: "finished", theme_name: "Archived theme" });
    });

    it("carries the activated season's announcement into the live overrides", async () => {
        insertSeason("name, is_active, status", "'Current', 1, 'voting'");
        insertSeason(
            "name, is_active, status, announcement",
            "'Next', 0, 'voting', 'Season two is live'",
        );

        await setActiveSeason(event, 2);

        const live = event.context.drizzle
            .prepare("SELECT announcement, live_overrides FROM hackathon WHERE id = 1")
            .first() as { announcement: string; live_overrides: string };
        expect(live.announcement).toBe("Season two is live");
        expect(JSON.parse(live.live_overrides)).toMatchObject({
            announcement: "Season two is live",
        });
    });

    it("seeds an unconfigured season from live settings before writing", async () => {
        insertSeason("name, is_active, status, theme_name", "'Current', 1, 'voting', 'Live theme'");
        insertSeason("name, is_active", "'Blank', 0");

        await setActiveSeason(event, 2);

        const written = readFileSync(manifestPath, "utf8");
        expect(written).toContain("theme_name: Live theme");
        const active = await getActiveSeason(event);
        expect(active).toMatchObject({ id: 2, is_active: 1, theme_name: "Live theme" });
    });

    it("does not rewrite the manifest when the season is already active", async () => {
        insertSeason("name, is_active, status", "'Current', 1, 'voting'");

        await setActiveSeason(event, 1);

        expect(readFileSync(manifestPath, "utf8")).toBe(manifest);
    });

    it("restores the previous active season when the manifest write fails", async () => {
        insertSeason("name, is_active, status, theme_name", "'Current', 1, 'voting', 'Live theme'");
        insertSeason("name, is_active, start_timestamp", "'Broken', 0, -1");

        await expect(setActiveSeason(event, 2)).rejects.toMatchObject({ statusCode: 409 });

        expect(readFileSync(manifestPath, "utf8")).toBe(manifest);
        const active = await getActiveSeason(event);
        expect(active).toMatchObject({ id: 1, name: "Current" });
        const restoredLive = event.context.drizzle
            .prepare("SELECT status, theme_name, live_overrides FROM hackathon WHERE id = 1")
            .first() as {
            status: string;
            theme_name: string;
            live_overrides: string;
        };
        expect(restoredLive.status).toBe("voting");
        expect(restoredLive.theme_name).toBe("Live theme");
        expect(JSON.parse(restoredLive.live_overrides)).toEqual({});
    });

    it("leaves no active season when a failed activation had none", async () => {
        insertSeason("name, is_active, start_timestamp", "'Broken', 0, -1");

        await expect(setActiveSeason(event, 1)).rejects.toMatchObject({ statusCode: 409 });

        await expect(getActiveSeason(event)).resolves.toBeNull();
    });

    it("restores nothing when the live row does not exist", async () => {
        event.context.drizzle.prepare("DELETE FROM hackathon WHERE id = 1").run();
        insertSeason("name, is_active, start_timestamp", "'Broken', 0, -1");

        await expect(setActiveSeason(event, 1)).rejects.toMatchObject({ statusCode: 409 });

        expect(
            event.context.drizzle.prepare("SELECT id FROM hackathon WHERE id = 1").first(),
        ).toBeUndefined();
    });
});
