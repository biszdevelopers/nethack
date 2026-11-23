import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createMockEvent } from "./helpers";
import {
    getTeamMembers,
    getAllTeamMembers,
    getUserPastTeams,
    addUserPastTeam,
    removeTeamMember,
    addTeamMember,
    createTeamInvite,
    getTeamMemberLimit,
    acceptTeamInvite,
} from "~~/server/utils/database/members";
import { teams, teamInvites } from "~~/server/database/schema";
import { invalidateRequestCaches } from "~~/server/utils/database/query";

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

        it("includes a current pointer to a team from an ended season", async () => {
            event.context.drizzle
                .prepare("INSERT INTO seasons(name, is_active) VALUES('Past season', 0)")
                .run();
            event.context.drizzle
                .prepare("INSERT INTO teams(name, season_id) VALUES('Archived Team', 2)")
                .run();
            event.context.drizzle.prepare("UPDATE users SET team_id = 3 WHERE id = 1").run();

            const teams = await getUserPastTeams(event, 1);
            expect(teams.map((team) => team.id)).toEqual([3]);
        });

        it("does not duplicate a team that is both current history and a past row", async () => {
            event.context.drizzle
                .prepare("INSERT INTO seasons(name, is_active) VALUES('Past season', 0)")
                .run();
            event.context.drizzle
                .prepare("INSERT INTO teams(name, season_id) VALUES('Archived Team', 2)")
                .run();
            event.context.drizzle.prepare("UPDATE users SET team_id = 3 WHERE id = 1").run();
            event.context.drizzle
                .prepare("INSERT INTO user_past_teams(user_id, team_id) VALUES(1, 3)")
                .run();

            const teams = await getUserPastTeams(event, 1);
            expect(teams.map((team) => team.id)).toEqual([3]);
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

        it("transfers ownership to the earliest remaining member when the owner leaves", async () => {
            event.context.drizzle.prepare("UPDATE teams SET owner_user_id = 1 WHERE id = 1").run();

            await removeTeamMember(event, 1, 1);

            const team = event.context.drizzle
                .select({ owner_user_id: teams.owner_user_id })
                .from(teams)
                .where(eq(teams.id, 1))
                .get();
            expect(team!.owner_user_id).toBe(2);
        });

        it("keeps the owner pointer when a non-owner leaves", async () => {
            event.context.drizzle.prepare("UPDATE teams SET owner_user_id = 1 WHERE id = 1").run();

            await removeTeamMember(event, 1, 2);

            const team = event.context.drizzle
                .select({ owner_user_id: teams.owner_user_id })
                .from(teams)
                .where(eq(teams.id, 1))
                .get();
            expect(team!.owner_user_id).toBe(1);
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

        it("throws a 404 error when the target team does not exist", async () => {
            await expect(addTeamMember(event, 999, 3)).rejects.toThrow(
                "User not found or already in a team",
            );
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

        it("allows a stale past-season team and records it as past membership", async () => {
            event.context.drizzle
                .prepare("INSERT INTO seasons(name, is_active) VALUES('S2', 0)")
                .run();
            event.context.drizzle
                .prepare("INSERT INTO teams(name, season_id) VALUES('Team C', 2)")
                .run();

            await addTeamMember(event, 3, 1);

            const user = event.context.drizzle
                .prepare("SELECT team_id FROM users WHERE id = 1")
                .first() as { team_id: number };
            expect(user!.team_id).toBe(3);
            expect((await getUserPastTeams(event, 1)).map((team) => team.id)).toContain(1);
        });

        it("throws when adding a user who is in a different team", async () => {
            await expect(addTeamMember(event, 2, 1)).rejects.toThrow(
                "User not found or already in a team",
            );
        });
    });

    describe("team limits and invite TTL", () => {
        it("refuses an invitation when the accepting user row no longer exists", async () => {
            const invite = await createTeamInvite(event, 1, "ghost@example.com", 1);

            await expect(
                acceptTeamInvite(event, invite.id, {
                    id: 999,
                    email: "ghost@example.com",
                } as User),
            ).rejects.toMatchObject({
                statusCode: 404,
                message: "Invitation not found",
            });
        });

        it("refuses an invitation when members plus pending invites reach the limit", async () => {
            event.context.drizzle
                .prepare("UPDATE seasons SET max_team_members = 2 WHERE id = 1")
                .run();
            invalidateRequestCaches(event);

            await expect(createTeamInvite(event, 1, "new@example.com", 1)).rejects.toMatchObject({
                statusCode: 409,
                message: "This team is full",
            });
        });

        it("falls back to the default cap when no season is active", async () => {
            event.context.drizzle.prepare("UPDATE seasons SET is_active = 0").run();
            invalidateRequestCaches(event);

            await expect(
                createTeamInvite(event, 1, "fallback@example.com", 1),
            ).resolves.toHaveProperty("token");
        });

        it("uses the active season's member limit and falls back when no season is active", async () => {
            event.context.drizzle
                .prepare("UPDATE seasons SET max_team_members = 4 WHERE id = 1")
                .run();
            await expect(getTeamMemberLimit(event)).resolves.toBe(4);

            event.context.drizzle.prepare("UPDATE seasons SET is_active = 0").run();
            invalidateRequestCaches(event);
            await expect(getTeamMemberLimit(event)).resolves.toBe(6);
        });

        it("clamps invalid invite TTL values to the default and floors valid ones", async () => {
            const readExpiryDays = async (email: string) => {
                await createTeamInvite(event, 1, email, 1);
                const invite = event.context.drizzle
                    .select()
                    .from(teamInvites)
                    .where(eq(teamInvites.email, email))
                    .get() as { expires_at?: string | Date | null };
                const expires = new Date(invite.expires_at ?? 0).getTime();
                return Math.round((expires - Date.now()) / (24 * 60 * 60 * 1000));
            };

            const original = process.env.TEAM_INVITE_TTL_DAYS;
            try {
                process.env.TEAM_INVITE_TTL_DAYS = "not-a-number";
                await expect(readExpiryDays("ttl-invalid@example.com")).resolves.toBe(7);
                process.env.TEAM_INVITE_TTL_DAYS = "400";
                await expect(readExpiryDays("ttl-high@example.com")).resolves.toBe(7);
                process.env.TEAM_INVITE_TTL_DAYS = "3.9";
                await expect(readExpiryDays("ttl-float@example.com")).resolves.toBe(3);
                process.env.TEAM_INVITE_TTL_DAYS = "0";
                await expect(readExpiryDays("ttl-zero@example.com")).resolves.toBe(7);
            } finally {
                if (original === undefined) delete process.env.TEAM_INVITE_TTL_DAYS;
                else process.env.TEAM_INVITE_TTL_DAYS = original;
            }
        });
    });
});
