import { beforeEach, describe, expect, it } from "vitest";
import { assertSeasonStillActive, deleteTeams, getTeamById } from "~~/server/utils/database/teams";
import { createMockEvent } from "./helpers";

describe("team deletion boundaries", () => {
    let event: Awaited<ReturnType<typeof createMockEvent>>;

    beforeEach(async () => {
        event = await createMockEvent();
        event.context.drizzle
            .prepare("INSERT INTO seasons(id, name, is_active) VALUES(1, 'Season', 1)")
            .run();
        event.context.drizzle
            .prepare("INSERT INTO teams(id, name, season_id) VALUES(1, 'Keep', 1)")
            .run();
    });

    it("treats an empty team selection as a no-op and preserves existing records", async () => {
        await expect(deleteTeams(event, [])).resolves.toBeUndefined();
        await expect(getTeamById(event, 1)).resolves.toMatchObject({ id: 1, name: "Keep" });
    });

    it("treats an empty transactional deletion as a no-op", async () => {
        const { deleteTeamsInTransaction } = await import("~~/server/utils/database/teams");

        await expect(
            deleteTeamsInTransaction(event.context.drizzle as any, []),
        ).resolves.toBeUndefined();
    });

    it("returns null for an all-season lookup when the team does not exist", async () => {
        const { getTeam } = await import("~~/server/utils/database/teams");

        await expect(getTeam(event, 404, true)).resolves.toBeNull();
    });

    it("rejects a missing or inactive locked season", () => {
        expect(() => assertSeasonStillActive(undefined)).toThrow("No active season");
        expect(() => assertSeasonStillActive({ is_active: 0 })).toThrow("No active season");
        expect(() => assertSeasonStillActive({ is_active: 1 })).not.toThrow();
    });

    it("rejects a partial update for a team that no longer exists", async () => {
        const { updateTeamPartial } = await import("~~/server/utils/database/teams");

        await expect(
            updateTeamPartial(event, 999, 1, { name: "Missing Team" }),
        ).rejects.toMatchObject({ statusCode: 404 });
        await expect(
            updateTeamPartial(event, 999, 1, { project_description: "Missing" }),
        ).rejects.toMatchObject({ statusCode: 404 });
    });

    it("reports a conflict for a guarded update of a withdrawn team", async () => {
        event.context.drizzle.prepare("UPDATE teams SET status = 'withdrawn' WHERE id = 1").run();
        const { updateTeamPartial } = await import("~~/server/utils/database/teams");

        await expect(
            updateTeamPartial(event, 1, 1, { name: "Renamed" }, { requireActive: true }),
        ).rejects.toMatchObject({
            statusCode: 409,
            message: "This team is no longer competing",
        });
    });
});
