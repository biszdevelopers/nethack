import { beforeEach, describe, expect, it } from "vitest";
import { deleteTeams, getTeamById } from "~~/server/utils/database/teams";
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

    it("returns null for an all-season lookup when the team does not exist", async () => {
        const { getTeam } = await import("~~/server/utils/database/teams");

        await expect(getTeam(event, 404, true)).resolves.toBeNull();
    });
});
