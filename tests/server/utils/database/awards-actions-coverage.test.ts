import { beforeEach, describe, expect, it } from "vitest";
import { getAwards } from "~~/server/utils/database/awards";
import { createMockEvent } from "./helpers";

describe("award metadata boundaries", () => {
    let event: Awaited<ReturnType<typeof createMockEvent>>;

    beforeEach(async () => {
        event = await createMockEvent();
        event.context.drizzle
            .prepare("INSERT INTO seasons(id, name, is_active) VALUES(1, 'Season', 1)")
            .run();
        event.context.drizzle
            .prepare("INSERT INTO teams(id, name, season_id) VALUES(1, 'Team', 1)")
            .run();
        event.context.drizzle
            .prepare(
                "INSERT INTO awards(namespace, name, description, icon) VALUES('legacy', 'Legacy', 'Legacy award', 'i-lucide-award')",
            )
            .run();
    });

    it("normalizes a legacy empty metadata value to an empty object", async () => {
        event.context.drizzle
            .prepare("INSERT INTO team_awards(team_id, award, meta) VALUES(1, 'legacy', '')")
            .run();

        await expect(getAwards(event, 1)).resolves.toMatchObject([
            { namespace: "legacy", meta: {} },
        ]);
    });
});
