import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { adminAuditEvents, teamInvites, userPastTeams, users } from "~~/server/database/schema";
import { createMockEvent } from "./helpers";
import {
    canManageTeam,
    createTeam,
    disbandTeam,
    getTeam,
    getAllTeams,
    getSubmittedUnjudgedTeams,
    getSubmittedTeams,
    getTeamById,
    getTeamBySeason,
    getAllTeamsAllSeasons,
    getTeamsBySeason,
    transferTeamOwnership,
    deleteTeams,
} from "~~/server/utils/database/teams";

function seedHackathon(event: Awaited<ReturnType<typeof createMockEvent>>) {
    event.context.drizzle
        .prepare(
            "INSERT INTO hackathon(id, status, start_timestamp, end_timestamp, voting_start_timestamp, voting_end_timestamp, results_open_timestamp) VALUES(1, 'not_started', 0, 0, 0, 0, 0)",
        )
        .run();
}

function seedSeason(
    event: Awaited<ReturnType<typeof createMockEvent>>,
    name: string,
    isActive: number,
) {
    event.context.drizzle
        .prepare("INSERT INTO seasons(name, is_active) VALUES(?, ?)")
        .bind(name, isActive)
        .run();
}

describe("teams database helpers", () => {
    let event: Awaited<ReturnType<typeof createMockEvent>>;

    beforeEach(async () => {
        event = await createMockEvent();
        seedHackathon(event);
    });

    describe("createTeam", () => {
        it("creates a team and assigns its owner atomically", async () => {
            seedSeason(event, "Season 1", 1);
            event.context.drizzle
                .prepare("INSERT INTO users(email) VALUES('owner@example.test')")
                .run();

            const team = await createTeam(event, "My Team", 1);
            expect(team).not.toBeNull();
            expect(team.name).toBe("My Team");
            expect(team.id).toBe(1);
            expect(team.season_id).toBe(1);
            const owner = event.context.drizzle
                .select({ team_id: users.team_id })
                .from(users)
                .where(eq(users.id, 1))
                .get() as { team_id: number };
            expect(owner.team_id).toBe(1);
        });

        it("rejects an owner who already belongs to the active season", async () => {
            seedSeason(event, "Season 1", 1);
            event.context.drizzle
                .prepare("INSERT INTO teams(id, name, season_id) VALUES(1, 'Existing', 1)")
                .run();
            event.context.drizzle
                .prepare("INSERT INTO users(email, team_id) VALUES('owner@example.test', 1)")
                .run();

            await expect(createTeam(event, "Second Team", 1)).rejects.toThrow(
                "Cannot create a team while in a team",
            );
        });

        it("records a previous-season team as history", async () => {
            seedSeason(event, "Season 1", 1);
            seedSeason(event, "Season 2", 0);
            event.context.drizzle
                .prepare("INSERT INTO teams(id, name, season_id) VALUES(2, 'Old Team', 2)")
                .run();
            event.context.drizzle
                .prepare("INSERT INTO users(email, team_id) VALUES('owner@example.test', 2)")
                .run();

            await createTeam(event, "New Team", 1);

            const history = event.context.drizzle
                .select({ team_id: userPastTeams.team_id })
                .from(userPastTeams)
                .where(eq(userPastTeams.user_id, 1))
                .all();
            expect(history.map(({ team_id }) => team_id)).toEqual([2]);
        });

        it("rejects a missing owner", async () => {
            seedSeason(event, "Season 1", 1);

            await expect(createTeam(event, "Ownerless Team", 404)).rejects.toThrow(
                "Logged in user not found",
            );
        });

        it("throws an error when there is no active season", async () => {
            await expect(createTeam(event, "Lonely Team", 1)).rejects.toThrow("No active season");
        });
    });

    describe("getTeam", () => {
        it("returns the team for the active season", async () => {
            seedSeason(event, "S1", 1);
            seedSeason(event, "S2", 0);

            event.context.drizzle
                .prepare("INSERT INTO teams(name, season_id) VALUES('Team A', 1)")
                .run();
            event.context.drizzle
                .prepare("INSERT INTO teams(name, season_id) VALUES('Team B', 2)")
                .run();

            const team = await getTeam(event, 1);
            expect(team).not.toBeNull();
            expect(team!.name).toBe("Team A");
        });

        it("returns null for a team in an inactive season", async () => {
            seedSeason(event, "S1", 1);
            seedSeason(event, "S2", 0);

            event.context.drizzle
                .prepare("INSERT INTO teams(name, season_id) VALUES('Team B', 2)")
                .run();

            const team = await getTeam(event, 1);
            expect(team).toBeNull();
        });

        it("returns the team regardless of season when allSeason is true", async () => {
            seedSeason(event, "S1", 1);
            seedSeason(event, "S2", 0);

            event.context.drizzle
                .prepare("INSERT INTO teams(name, season_id) VALUES('Team B', 2)")
                .run();

            const team = await getTeam(event, 1, true);
            expect(team).not.toBeNull();
            expect(team!.name).toBe("Team B");
        });

        it("returns null for a non-existing team", async () => {
            seedSeason(event, "S1", 1);

            const team = await getTeam(event, 999);
            expect(team).toBeNull();
        });

        it("returns null when there is no active season", async () => {
            event.context.drizzle
                .prepare("INSERT INTO teams(name, season_id) VALUES('Team A', 1)")
                .run();

            const team = await getTeam(event, 1);
            expect(team).toBeNull();
        });
    });

    describe("getAllTeams", () => {
        it("returns all teams for the active season", async () => {
            seedSeason(event, "S1", 1);
            seedSeason(event, "S2", 0);

            event.context.drizzle
                .prepare("INSERT INTO teams(name, season_id) VALUES('Team A', 1)")
                .run();
            event.context.drizzle
                .prepare("INSERT INTO teams(name, season_id) VALUES('Team B', 1)")
                .run();
            event.context.drizzle
                .prepare("INSERT INTO teams(name, season_id) VALUES('Team C', 2)")
                .run();

            const teams = await getAllTeams(event);
            expect(teams).toHaveLength(2);
            expect(teams.map((t) => t.name)).toEqual(["Team A", "Team B"]);
        });

        it("returns an empty array when there is no active season", async () => {
            event.context.drizzle
                .prepare("INSERT INTO teams(name, season_id) VALUES('Team A', 1)")
                .run();

            const teams = await getAllTeams(event);
            expect(teams).toHaveLength(0);
        });
    });

    describe("getSubmittedUnjudgedTeams", () => {
        it("returns submitted teams that have not been judged by the given user", async () => {
            seedSeason(event, "S1", 1);

            event.context.drizzle
                .prepare(
                    "INSERT INTO teams(name, season_id, project_submitted) VALUES('Team A', 1, 1)",
                )
                .run();
            event.context.drizzle
                .prepare(
                    "INSERT INTO teams(name, season_id, project_submitted) VALUES('Team B', 1, 1)",
                )
                .run();
            event.context.drizzle
                .prepare(
                    "INSERT INTO teams(name, season_id, project_submitted) VALUES('Team C', 1, 0)",
                )
                .run();

            // Insert a user for the judge
            event.context.drizzle
                .prepare("INSERT INTO users(email) VALUES('judge@example.com')")
                .run();

            // Judge already scored Team A
            event.context.drizzle
                .prepare(
                    "INSERT INTO team_scores(team_id, judge_user_id, scores) VALUES(1, 1, '{}')",
                )
                .run();

            const teams = await getSubmittedUnjudgedTeams(event, 1);
            expect(teams).toHaveLength(1);
            expect(teams[0]!.name).toBe("Team B");
        });

        it("excludes withdrawn teams from the queue", async () => {
            seedSeason(event, "S1", 1);
            event.context.drizzle
                .prepare(
                    "INSERT INTO teams(name, season_id, project_submitted) VALUES('Active Team', 1, 1)",
                )
                .run();
            event.context.drizzle
                .prepare(
                    "INSERT INTO teams(name, season_id, project_submitted, status) VALUES('Withdrawn Team', 1, 1, 'withdrawn')",
                )
                .run();

            const teams = await getSubmittedUnjudgedTeams(event, 1);

            expect(teams.map((team) => team.name)).toEqual(["Active Team"]);
        });

        it("excludes the judge's own team from the queue", async () => {
            seedSeason(event, "S1", 1);
            event.context.drizzle
                .prepare(
                    "INSERT INTO teams(name, season_id, project_submitted) VALUES('Own Team', 1, 1)",
                )
                .run();
            event.context.drizzle
                .prepare(
                    "INSERT INTO teams(name, season_id, project_submitted) VALUES('Other Team', 1, 1)",
                )
                .run();

            const teams = await getSubmittedUnjudgedTeams(event, 9, 1);

            expect(teams.map((team) => team.name)).toEqual(["Other Team"]);
        });

        it("returns an empty array when there is no active season", async () => {
            event.context.drizzle
                .prepare(
                    "INSERT INTO teams(name, season_id, project_submitted) VALUES('Team A', 1, 1)",
                )
                .run();

            const teams = await getSubmittedUnjudgedTeams(event, 1);
            expect(teams).toHaveLength(0);
        });
    });

    describe("getSubmittedTeams", () => {
        it("returns all submitted teams for the active season", async () => {
            seedSeason(event, "S1", 1);

            event.context.drizzle
                .prepare(
                    "INSERT INTO teams(name, season_id, project_submitted) VALUES('Team A', 1, 1)",
                )
                .run();
            event.context.drizzle
                .prepare(
                    "INSERT INTO teams(name, season_id, project_submitted) VALUES('Team B', 1, 0)",
                )
                .run();
            event.context.drizzle
                .prepare(
                    "INSERT INTO teams(name, season_id, project_submitted) VALUES('Team C', 1, 1)",
                )
                .run();

            const teams = await getSubmittedTeams(event);
            expect(teams).toHaveLength(2);
            expect(teams.map((t) => t.name)).toEqual(["Team A", "Team C"]);
        });

        it("returns an empty array when there is no active season", async () => {
            event.context.drizzle
                .prepare(
                    "INSERT INTO teams(name, season_id, project_submitted) VALUES('Team A', 1, 1)",
                )
                .run();

            const teams = await getSubmittedTeams(event);
            expect(teams).toHaveLength(0);
        });
    });

    describe("getTeamById", () => {
        it("returns the team by id regardless of season", async () => {
            seedSeason(event, "S1", 1);
            seedSeason(event, "S2", 0);

            event.context.drizzle
                .prepare("INSERT INTO teams(name, season_id) VALUES('Team B', 2)")
                .run();

            const team = await getTeamById(event, 1);
            expect(team).not.toBeNull();
            expect(team!.name).toBe("Team B");
        });

        it("returns null for a non-existing team", async () => {
            const team = await getTeamById(event, 999);
            expect(team).toBeNull();
        });
    });

    describe("getTeamBySeason", () => {
        it("returns the team when it belongs to the specified season", async () => {
            seedSeason(event, "S1", 1);
            seedSeason(event, "S2", 0);

            event.context.drizzle
                .prepare("INSERT INTO teams(name, season_id) VALUES('Team A', 1)")
                .run();
            event.context.drizzle
                .prepare("INSERT INTO teams(name, season_id) VALUES('Team B', 2)")
                .run();

            const team = await getTeamBySeason(event, 1, 1);
            expect(team).not.toBeNull();
            expect(team!.name).toBe("Team A");
        });

        it("returns null when the team is not in the specified season", async () => {
            seedSeason(event, "S1", 1);
            seedSeason(event, "S2", 0);

            event.context.drizzle
                .prepare("INSERT INTO teams(name, season_id) VALUES('Team A', 1)")
                .run();

            const team = await getTeamBySeason(event, 1, 2);
            expect(team).toBeNull();
        });
    });

    describe("getAllTeamsAllSeasons", () => {
        it("returns all teams across all seasons", async () => {
            seedSeason(event, "S1", 1);
            seedSeason(event, "S2", 0);

            event.context.drizzle
                .prepare("INSERT INTO teams(name, season_id) VALUES('Team A', 1)")
                .run();
            event.context.drizzle
                .prepare("INSERT INTO teams(name, season_id) VALUES('Team B', 2)")
                .run();

            const teams = await getAllTeamsAllSeasons(event);
            expect(teams).toHaveLength(2);
        });
    });

    describe("getTeamsBySeason", () => {
        it("returns teams for a specific season", async () => {
            seedSeason(event, "S1", 1);
            seedSeason(event, "S2", 0);

            event.context.drizzle
                .prepare("INSERT INTO teams(name, season_id) VALUES('Team A', 1)")
                .run();
            event.context.drizzle
                .prepare("INSERT INTO teams(name, season_id) VALUES('Team B', 1)")
                .run();
            event.context.drizzle
                .prepare("INSERT INTO teams(name, season_id) VALUES('Team C', 2)")
                .run();

            const teams = await getTeamsBySeason(event, 1);
            expect(teams).toHaveLength(2);
            expect(teams.map((t) => t.name)).toEqual(["Team A", "Team B"]);
        });
    });

    describe("deleteTeams", () => {
        it("deletes a single team", async () => {
            seedSeason(event, "S1", 1);

            event.context.drizzle
                .prepare("INSERT INTO teams(name, season_id) VALUES('Team A', 1)")
                .run();

            await deleteTeams(event, [1]);
            const team = await getTeamById(event, 1);
            expect(team).toBeNull();
        });

        it("deletes multiple teams", async () => {
            seedSeason(event, "S1", 1);

            event.context.drizzle
                .prepare("INSERT INTO teams(name, season_id) VALUES('Team A', 1)")
                .run();
            event.context.drizzle
                .prepare("INSERT INTO teams(name, season_id) VALUES('Team B', 1)")
                .run();
            event.context.drizzle
                .prepare("INSERT INTO teams(name, season_id) VALUES('Team C', 1)")
                .run();

            await deleteTeams(event, [1, 3]);

            expect(await getTeamById(event, 1)).toBeNull();
            expect(await getTeamById(event, 2)).not.toBeNull();
            expect(await getTeamById(event, 3)).toBeNull();
        });

        it("cascades properly by clearing user team references and related records", async () => {
            seedSeason(event, "S1", 1);

            event.context.drizzle
                .prepare("INSERT INTO teams(name, season_id) VALUES('Team A', 1)")
                .run();
            event.context.drizzle
                .prepare("INSERT INTO users(email, team_id) VALUES('user@example.com', 1)")
                .run();
            event.context.drizzle
                .prepare("INSERT INTO users(email, team_id) VALUES('judge@example.com', NULL)")
                .run();

            // Create related records
            event.context.drizzle
                .prepare(
                    "INSERT INTO team_scores(team_id, judge_user_id, scores) VALUES(1, 2, '{}')",
                )
                .run();
            event.context.drizzle.prepare("INSERT INTO ballots(user_id) VALUES(1)").run();
            event.context.drizzle
                .prepare("INSERT INTO ballot_scores(ballot_id, project_id) VALUES(1, 1)")
                .run();
            event.context.drizzle
                .prepare("INSERT INTO team_awards(team_id, award, meta) VALUES(1, 'best', '{}')")
                .run();
            event.context.drizzle
                .prepare("INSERT INTO user_past_teams(user_id, team_id) VALUES(1, 1)")
                .run();

            await deleteTeams(event, [1]);

            // Team should be gone
            expect(await getTeamById(event, 1)).toBeNull();

            // User's team_id should be cleared
            const user = event.context.drizzle
                .prepare("SELECT * FROM users WHERE id = 1")
                .first() as any;
            expect(user.team_id).toBeNull();

            // Related scores should be cleaned up
            const teamScores = event.context.drizzle
                .prepare("SELECT * FROM team_scores WHERE team_id = 1")
                .all() as { results: any[] };
            expect(teamScores.results).toHaveLength(0);

            const ballotScores = event.context.drizzle
                .prepare("SELECT * FROM ballot_scores WHERE project_id = 1")
                .all() as { results: any[] };
            expect(ballotScores.results).toHaveLength(0);

            const awards = event.context.drizzle
                .prepare("SELECT * FROM team_awards WHERE team_id = 1")
                .all() as { results: any[] };
            expect(awards.results).toHaveLength(0);

            const pastTeams = event.context.drizzle
                .prepare("SELECT * FROM user_past_teams WHERE team_id = 1")
                .all() as { results: any[] };
            expect(pastTeams.results).toHaveLength(0);
        });
    });

    describe("team ownership", () => {
        it("recognizes only the owner and administrators as managers", () => {
            expect(canManageTeam({ owner_user_id: 7 }, { id: 7, is_admin: 0 })).toBe(true);
            expect(canManageTeam({ owner_user_id: 7 }, { id: 8, is_admin: 0 })).toBe(false);
            expect(canManageTeam({ owner_user_id: 7 }, { id: 8, is_admin: 1 })).toBe(true);
            expect(canManageTeam({ owner_user_id: null }, { id: 8, is_admin: 0 })).toBe(true);
        });

        it("transfers ownership to a current member and audits the change", async () => {
            seedSeason(event, "S1", 1);
            event.context.drizzle
                .prepare("INSERT INTO teams(name, season_id, owner_user_id) VALUES('Team A', 1, 1)")
                .run();
            event.context.drizzle
                .prepare("INSERT INTO users(email, team_id) VALUES('owner@example.com', 1)")
                .run();
            event.context.drizzle
                .prepare("INSERT INTO users(email, team_id) VALUES('member@example.com', 1)")
                .run();

            await transferTeamOwnership(event, 1, 2);

            const team = await getTeamById(event, 1);
            expect(team!.owner_user_id).toBe(2);
            expect(event.context.drizzle.select().from(adminAuditEvents).all()).toHaveLength(1);
        });

        it("rejects transferring ownership to a non-member", async () => {
            seedSeason(event, "S1", 1);
            event.context.drizzle
                .prepare("INSERT INTO teams(name, season_id) VALUES('Team A', 1)")
                .run();
            event.context.drizzle
                .prepare("INSERT INTO users(email) VALUES('outsider@example.com')")
                .run();

            await expect(transferTeamOwnership(event, 1, 1)).rejects.toMatchObject({
                statusCode: 404,
            });
        });

        it("withdraws a team, records history, and removes pending invitations", async () => {
            seedSeason(event, "S1", 1);
            event.context.drizzle
                .prepare("INSERT INTO teams(name, season_id) VALUES('Team A', 1)")
                .run();
            event.context.drizzle
                .prepare("INSERT INTO users(email, team_id) VALUES('owner@example.com', 1)")
                .run();
            event.context.drizzle
                .prepare("INSERT INTO users(email, team_id) VALUES('member@example.com', 1)")
                .run();
            event.context.drizzle
                .prepare("INSERT INTO team_invites(team_id, email) VALUES(1, 'newbie@example.com')")
                .run();

            await disbandTeam(event, 1);

            const team = await getTeamById(event, 1);
            expect(team!.status).toBe("withdrawn");
            expect(
                event.context.drizzle.select().from(users).where(eq(users.team_id, 1)).all(),
            ).toHaveLength(0);
            expect(
                event.context.drizzle
                    .select()
                    .from(userPastTeams)
                    .all()
                    .map((row) => row.user_id),
            ).toEqual([1, 2]);
            expect(event.context.drizzle.select().from(teamInvites).all()).toHaveLength(0);
        });

        it("rejects disbanding a submitted or judged team", async () => {
            seedSeason(event, "S1", 1);
            event.context.drizzle
                .prepare("INSERT INTO teams(name, season_id) VALUES('Submitted', 1)")
                .run();
            event.context.drizzle
                .prepare("INSERT INTO teams(name, season_id) VALUES('Judged', 1)")
                .run();
            event.context.drizzle
                .prepare("INSERT INTO users(email) VALUES('judge@example.com')")
                .run();
            event.context.drizzle
                .prepare("UPDATE teams SET project_submitted = 1 WHERE id = 1")
                .run();
            event.context.drizzle
                .prepare(
                    "INSERT INTO team_scores(team_id, judge_user_id, scores) VALUES(2, 1, '{}')",
                )
                .run();

            await expect(disbandTeam(event, 1)).rejects.toMatchObject({ statusCode: 409 });
            await expect(disbandTeam(event, 2)).rejects.toMatchObject({ statusCode: 409 });
        });
    });
});
