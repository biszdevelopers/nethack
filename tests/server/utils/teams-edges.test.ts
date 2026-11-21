import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createMockEvent } from "./database/helpers";
import { teams, seasons } from "~~/server/database/schema";
import { disbandTeam, getPublicTeams, transferTeamOwnership } from "~~/server/utils/database/teams";

type MockEvent = Awaited<ReturnType<typeof createMockEvent>>;

let event: MockEvent;

beforeEach(async () => {
    event = await createMockEvent();
});

function seedSeason(name: string, isActive: number) {
    return event.context.drizzle
        .insert(seasons)
        .values({ name, is_active: isActive } as any)
        .returning()
        .get().id;
}

function seedTeamRow(
    name: string,
    seasonId: number,
    overrides: { submitted?: number; status?: string } = {},
) {
    return event.context.drizzle
        .insert(teams)
        .values({
            name,
            season_id: seasonId,
            project_submitted: overrides.submitted ?? 1,
            status: overrides.status ?? "active",
        } as any)
        .returning()
        .get().id;
}

describe("getPublicTeams", () => {
    it("returns only submitted active projects for an explicit season", async () => {
        const seasonId = seedSeason("Season 1", 1);
        const other = seedSeason("Season 2", 0);
        const published = seedTeamRow("Published", seasonId);
        seedTeamRow("Draft", seasonId, { submitted: 0 });
        seedTeamRow("Withdrawn", seasonId, { status: "withdrawn" });
        seedTeamRow("Other season", other);

        const rows = await getPublicTeams(event, seasonId);

        expect(rows.map((row) => row.id)).toEqual([published]);
    });

    it("defaults to the active season", async () => {
        const active = seedSeason("Active", 1);
        const past = seedSeason("Past", 0);
        const published = seedTeamRow("Active project", active);
        seedTeamRow("Past project", past);

        const rows = await getPublicTeams(event);

        expect(rows.map((row) => row.id)).toEqual([published]);
    });

    it("matches nothing when no season is active", async () => {
        const past = seedSeason("Past", 0);
        seedTeamRow("Past project", past);

        await expect(getPublicTeams(event)).resolves.toEqual([]);
    });
});

describe("disbandTeam guards", () => {
    it("returns 404 for an unknown team", async () => {
        await expect(disbandTeam(event, 999)).rejects.toMatchObject({ statusCode: 404 });
    });
});

describe("transferTeamOwnership guards", () => {
    it("returns 404 for an unknown team", async () => {
        await expect(transferTeamOwnership(event, 999, 1)).rejects.toMatchObject({
            statusCode: 404,
        });
    });

    it("returns 409 when the target already owns the team", async () => {
        const seasonId = seedSeason("Season 1", 1);
        const teamId = seedTeamRow("Owned", seasonId);
        event.context.drizzle
            .prepare("UPDATE teams SET owner_user_id = 2 WHERE id = ?")
            .bind(teamId)
            .run();
        event.context.drizzle
            .prepare("INSERT INTO users(email, team_id) VALUES('owner@example.test', ?)")
            .bind(teamId)
            .run();

        await expect(transferTeamOwnership(event, teamId, 2)).rejects.toMatchObject({
            statusCode: 409,
            message: "That member already owns this team",
        });
    });
});

describe("team history helpers", () => {
    it("clears a disbanded team reference and records every member", async () => {
        const seasonId = seedSeason("Season 1", 1);
        const teamId = seedTeamRow("To disband", seasonId, { submitted: 0 });
        event.context.drizzle
            .prepare("INSERT INTO users(email, team_id) VALUES('a@example.test', ?)")
            .bind(teamId)
            .run();
        event.context.drizzle
            .prepare("INSERT INTO users(email, team_id) VALUES('b@example.test', ?)")
            .bind(teamId)
            .run();

        await disbandTeam(event, teamId);

        const row = event.context.drizzle.select().from(teams).where(eq(teams.id, teamId)).get();
        expect(row!.status).toBe("withdrawn");
        expect(
            event.context.drizzle.prepare("SELECT count(*) AS count FROM user_past_teams").first(),
        ).toEqual({ count: 2 });
    });
});
