import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockEvent } from "./helpers";
import {
    acquireActivationLock,
    getActiveSeason,
    setActiveSeason,
} from "~~/server/utils/database/seasons";
import { getHackathon } from "~~/server/utils/database/hackathon";

describe("PostgreSQL-only season activation", () => {
    let event: Awaited<ReturnType<typeof createMockEvent>>;
    beforeEach(async () => {
        event = await createMockEvent();
        event.context.drizzle
            .prepare(
                "INSERT INTO hackathon(id, status, start_timestamp, end_timestamp, voting_start_timestamp, voting_end_timestamp, results_open_timestamp, theme_name) VALUES(1, 'voting', 100, 200, 100, 200, 300, 'Live theme')",
            )
            .run();
        event.context.drizzle
            .prepare(
                "INSERT INTO seasons(id, name, is_active, status, theme_name) VALUES(1, 'Current', 1, 'voting', 'Live theme'), (2, 'Next', 0, 'finished', 'Next theme')",
            )
            .run();
    });

    it("activates all stored settings and invalidates cached live settings", async () => {
        event.context.drizzle
            .prepare(
                "UPDATE seasons SET announcement = 'New announcement', start_timestamp = 400, end_timestamp = 500, judging_open = 1 WHERE id = 2",
            )
            .run();
        await getHackathon(event);
        await setActiveSeason(event, 2);
        expect(await getActiveSeason(event)).toMatchObject({
            id: 2,
            status: "finished",
            theme_name: "Next theme",
            start_timestamp: 400,
        });
        expect(await getHackathon(event)).toMatchObject({
            status: "finished",
            theme_name: "Next theme",
            announcement: "New announcement",
            start_timestamp: 400,
            end_timestamp: 500,
            judging_open: 1,
        });
    });

    it("seeds an ordinary blank season from the stored live settings", async () => {
        event.context.drizzle
            .prepare("UPDATE seasons SET status = 'not_started', theme_name = NULL WHERE id = 2")
            .run();
        await setActiveSeason(event, 2);
        expect(await getActiveSeason(event)).toMatchObject({
            id: 2,
            theme_name: "Live theme",
            start_timestamp: 100,
        });
    });

    it("keeps the previous live season and settings if activation fails", async () => {
        event.context.drizzle.prepare("UPDATE seasons SET is_blank_start = 1 WHERE id = 2").run();
        await expect(setActiveSeason(event, 2)).rejects.toMatchObject({ statusCode: 409 });
        expect(await getActiveSeason(event)).toMatchObject({ id: 1, is_active: 1 });
        expect(await getHackathon(event)).toMatchObject({ status: "voting", start_timestamp: 100 });
    });

    it("rejects an unknown season without deactivating the current season", async () => {
        await expect(setActiveSeason(event, 999)).rejects.toMatchObject({ statusCode: 404 });
        expect(await getActiveSeason(event)).toMatchObject({ id: 1 });
    });

    it("takes the PostgreSQL advisory lock when row locks are available", async () => {
        const execute = vi.fn(async () => undefined);
        await acquireActivationLock({
            select: () => ({ from: () => ({ limit: () => ({ for: () => undefined }) }) }),
            execute,
        });
        expect(execute).toHaveBeenCalledOnce();
        execute.mockClear();
        await acquireActivationLock({
            select: () => ({ from: () => ({ limit: () => ({}) }) }),
            execute,
        });
        expect(execute).not.toHaveBeenCalled();
    });
});
