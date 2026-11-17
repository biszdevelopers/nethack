import { describe, it, expect, beforeEach } from "vitest";
import { createMockEvent } from "./helpers";
import {
    getTeamMembers,
    getAllTeamMembers,
    getUserPastTeams,
    addUserPastTeam,
    removeTeamMember,
    addTeamMember,
} from "~~/server/utils/database/members";

describe("members database helpers", () => {
    let event: Awaited<ReturnType<typeof createMockEvent>>;

    beforeEach(async () => {
        event = await createMockEvent();
        // Seed hackathon, season, and team
        event.context.drizzle
            .prepare(
                "INSERT INTO hackathon(id, status, start_timestamp, end_timestamp, voting_start_timestamp, voting_end_timestamp, results_open_timestamp) VALUES(1, 'not_started', 0, 0, 0, 0, 0)",
            )
            .run();
        event.context.drizzle.prepare("INSERT INTO seasons(name, is_active) VALUES('S1', 1)").run();
        event.context.drizzle
            .prepare("INSERT INTO teams(name, season_id) VALUES('Team A', 1)")
            .run();
        event.context.drizzle
            .prepare("INSERT INTO teams(name, season_id) VALUES('Team B', 1)")
            .run();
        // Seed users
        event.context.drizzle
            .prepare(
                "INSERT INTO users(email, name, team_id) VALUES('alice@example.com', 'Alice', 1)",
            )
            .run();
        event.context.drizzle
            .prepare("INSERT INTO users(email, name, team_id) VALUES('bob@example.com', 'Bob', 1)")
            .run();
        event.context.drizzle
            .prepare(
                "INSERT INTO users(email, name, team_id) VALUES('carol@example.com', 'Carol', NULL)",
            )
            .run();
    });

    describe("getTeamMembers", () => {
        it("returns the current members of a team", async () => {
            const members = await getTeamMembers(event, 1);
            expect(members).toHaveLength(2);
            expect(members.map((m) => m.name)).toEqual(["Alice", "Bob"]);
        });

        it("returns an empty array for a team with no members", async () => {
            const members = await getTeamMembers(event, 2);
            expect(members).toHaveLength(0);
        });

        it("does not include past team members", async () => {
            event.context.drizzle
                .prepare("INSERT INTO user_past_teams(user_id, team_id) VALUES(3, 1)")
                .run();

            const members = await getTeamMembers(event, 1);
            expect(members).toHaveLength(2);
            expect(members.map((m) => m.name)).toEqual(["Alice", "Bob"]);
        });

        it("returns an empty array for a non-existent team id", async () => {
            const members = await getTeamMembers(event, 999);
            expect(members).toHaveLength(0);
        });
    });

    describe("getAllTeamMembers", () => {
        it("includes past team members alongside current members", async () => {
            // Add Carol as a past team member of Team A
            event.context.drizzle
                .prepare("INSERT INTO user_past_teams(user_id, team_id) VALUES(3, 1)")
                .run();

            const members = await getAllTeamMembers(event, 1);
            expect(members).toHaveLength(3);
            expect(members.map((m) => m.name)).toEqual(["Alice", "Bob", "Carol"]);
        });

        it("deduplicates a current member who also has past-team history", async () => {
            // Alice is a current member of Team A and also has a past-team record
            event.context.drizzle
                .prepare("INSERT INTO user_past_teams(user_id, team_id) VALUES(1, 1)")
                .run();

            const members = await getAllTeamMembers(event, 1);
            expect(members).toHaveLength(2);
            expect(members.map((m) => m.name)).toEqual(["Alice", "Bob"]);
        });

        it("returns just current members when there are no past members", async () => {
            const members = await getAllTeamMembers(event, 1);
            expect(members).toHaveLength(2);
            expect(members.map((m) => m.name)).toEqual(["Alice", "Bob"]);
        });

        it("returns an empty array when the team has no members at all", async () => {
            const members = await getAllTeamMembers(event, 2);
            expect(members).toHaveLength(0);
        });

        it("includes multiple past team members", async () => {
            event.context.drizzle
                .prepare("INSERT INTO users(email, name) VALUES('dave@example.com', 'Dave')")
                .run();
            event.context.drizzle
                .prepare("INSERT INTO user_past_teams(user_id, team_id) VALUES(3, 1)")
                .run();
            event.context.drizzle
                .prepare("INSERT INTO user_past_teams(user_id, team_id) VALUES(4, 1)")
                .run();

            const members = await getAllTeamMembers(event, 1);
            expect(members).toHaveLength(4);
            expect(members.map((m) => m.name)).toEqual(["Alice", "Bob", "Carol", "Dave"]);
        });
    });

    describe("getUserPastTeams", () => {
        it("returns past teams for a user", async () => {
            event.context.drizzle
                .prepare("INSERT INTO user_past_teams(user_id, team_id) VALUES(1, 2)")
                .run();

            const teams = await getUserPastTeams(event, 1);
            expect(teams).toHaveLength(1);
            expect(teams[0]!.id).toBe(2);
            expect(teams[0]!.name).toBe("Team B");
        });

        it("returns an empty array when the user has no past teams", async () => {
            const teams = await getUserPastTeams(event, 1);
            expect(teams).toHaveLength(0);
        });

        it("returns multiple past teams for a user", async () => {
            event.context.drizzle
                .prepare("INSERT INTO user_past_teams(user_id, team_id) VALUES(1, 2)")
                .run();
            // Add another team for past teams
            event.context.drizzle
                .prepare("INSERT INTO teams(name, season_id) VALUES('Team C', 1)")
                .run();
            event.context.drizzle
                .prepare("INSERT INTO user_past_teams(user_id, team_id) VALUES(1, 3)")
                .run();

            const teams = await getUserPastTeams(event, 1);
            expect(teams).toHaveLength(2);
        });

        it("returns an empty array for a non-existent user id", async () => {
            const teams = await getUserPastTeams(event, 999);
            expect(teams).toHaveLength(0);
        });
    });

    describe("addUserPastTeam", () => {
        it("adds a past team record successfully", async () => {
            await addUserPastTeam(event, 1, 2);

            const teams = await getUserPastTeams(event, 1);
            expect(teams).toHaveLength(1);
            expect(teams[0]!.id).toBe(2);
        });

        it("ignores duplicate insert", async () => {
            await addUserPastTeam(event, 1, 2);
            await addUserPastTeam(event, 1, 2); // Should not throw

            const teams = await getUserPastTeams(event, 1);
            expect(teams).toHaveLength(1);
        });

        it("adds multiple past teams for the same user", async () => {
            event.context.drizzle
                .prepare("INSERT INTO teams(name, season_id) VALUES('Team C', 1)")
                .run();

            await addUserPastTeam(event, 1, 2);
            await addUserPastTeam(event, 1, 3);

            const teams = await getUserPastTeams(event, 1);
            expect(teams).toHaveLength(2);
        });

        it("throws when adding with a non-existent user id due to FK constraint", async () => {
            await expect(addUserPastTeam(event, 999, 1)).rejects.toThrow();
        });

        it("throws when adding with a non-existent team id due to FK constraint", async () => {
            await expect(addUserPastTeam(event, 1, 999)).rejects.toThrow();
        });
    });

    describe("removeTeamMember", () => {
        it("removes a member from a team and records the past team", async () => {
            await removeTeamMember(event, 1, 1);

            // Alice should no longer be on Team A
            const members = await getTeamMembers(event, 1);
            expect(members).toHaveLength(1);
            expect(members[0]!.name).toBe("Bob");

            // Alice should have Team A in her past teams
            const pastTeams = await getUserPastTeams(event, 1);
            expect(pastTeams).toHaveLength(1);
            expect(pastTeams[0]!.id).toBe(1);
        });

        it("throws a 404 error when the user is not in the team", async () => {
            await expect(removeTeamMember(event, 1, 3)).rejects.toThrow(
                "User not found or not in team",
            );

            // Removing a non-member must not create a past-team entry
            const pastTeams = event.context.drizzle
                .prepare("SELECT * FROM user_past_teams WHERE user_id = 3 AND team_id = 1")
                .all();
            expect(pastTeams.results).toHaveLength(0);
        });

        it("throws a 404 error when the user does not exist", async () => {
            await expect(removeTeamMember(event, 1, 999)).rejects.toThrow(
                "User not found or not in team",
            );
        });

        it("throws a 404 error when the user is in a different team", async () => {
            event.context.drizzle
                .prepare(
                    "INSERT INTO users(email, name, team_id) VALUES('dave@example.com', 'Dave', 2)",
                )
                .run();

            await expect(removeTeamMember(event, 1, 4)).rejects.toThrow(
                "User not found or not in team",
            );
        });

        it("keeps the last member so the team is not orphaned", async () => {
            await removeTeamMember(event, 1, 1);

            await expect(removeTeamMember(event, 1, 2)).rejects.toMatchObject({
                statusCode: 409,
                message: "Every team must keep at least one member",
            });
            expect(await getTeamMembers(event, 1)).toHaveLength(1);
        });

        it("does not record a past team entry on failure", async () => {
            await expect(removeTeamMember(event, 1, 3)).rejects.toThrow();

            const pastTeams = event.context.drizzle.prepare("SELECT * FROM user_past_teams").all();
            expect(pastTeams.results).toHaveLength(0);
        });
    });

    describe("addTeamMember", () => {
        it("adds a user to a team successfully", async () => {
            await addTeamMember(event, 1, 3);

            const members = await getTeamMembers(event, 1);
            expect(members).toHaveLength(3);
            expect(members.map((m) => m.name)).toContain("Carol");
        });

        it("throws a 404 error when the user is already in a team", async () => {
            await expect(addTeamMember(event, 1, 1)).rejects.toThrow(
                "User not found or already in a team",
            );
        });

        it("throws a 404 error when the user does not exist", async () => {
            await expect(addTeamMember(event, 1, 999)).rejects.toThrow(
                "User not found or already in a team",
            );
        });

        it("updates the user's team_id after adding", async () => {
            await addTeamMember(event, 1, 3);

            const user = event.context.drizzle
                .prepare("SELECT team_id FROM users WHERE id = 3")
                .first() as { team_id: number | null };
            expect(user!.team_id).toBe(1);
        });

        it("throws when adding a user who is in a different team", async () => {
            await expect(addTeamMember(event, 2, 1)).rejects.toThrow(
                "User not found or already in a team",
            );
        });
    });
});
