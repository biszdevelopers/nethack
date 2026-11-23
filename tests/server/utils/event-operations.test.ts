import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createMockEvent } from "./database/helpers";
import { writeAuditEvent } from "~~/server/utils/audit";
import {
    createNotification,
    notifyTeamOwner,
    notifyUserByEmail,
} from "~~/server/utils/notifications";
import { summarizePeerVoting } from "~~/server/utils/voting";
import { adminAuditEvents, notifications } from "~~/server/database/schema";

describe("event operations helpers", () => {
    let event: Awaited<ReturnType<typeof createMockEvent>>;
    let raw: any;

    beforeEach(async () => {
        event = await createMockEvent();
        raw = event.context.drizzle.getRawDb();
        raw.prepare(
            "INSERT INTO users(id, email, name) VALUES(1, 'actor@test.invalid', 'Actor')",
        ).run();
        raw.prepare(
            "INSERT INTO users(id, email, name) VALUES(2, 'owner@test.invalid', 'Owner')",
        ).run();
        raw.prepare(
            "INSERT INTO users(id, email, name) VALUES(3, 'invitee@test.invalid', 'Invitee')",
        ).run();
        raw.prepare(
            "INSERT INTO teams(id, name, season_id, owner_user_id) VALUES(10, 'Owned team', 1, 2)",
        ).run();
        raw.prepare("UPDATE users SET team_id = 10 WHERE id = 2").run();
        (event.context as any).basisAuthValidatedUser = { subject: "s", user: { id: 1 } };
    });

    it("writes an immutable audit event with the acting account", async () => {
        await writeAuditEvent(event.context.drizzle, event, {
            action: "team.status",
            entity_type: "team",
            entity_id: 10,
            before: { status: "active" },
            after: { status: "withdrawn" },
            reason: "rule violation",
        });

        const [row] = await event.context.drizzle
            .select()
            .from(adminAuditEvents)
            .where(eq(adminAuditEvents.entity_id, "10"));
        expect(row).toMatchObject({
            actor_user_id: 1,
            action: "team.status",
            entity_type: "team",
            entity_id: "10",
            before: { status: "active" },
            after: { status: "withdrawn" },
            reason: "rule violation",
        });
    });

    it("delivers notifications to an email and to a team owner", async () => {
        await notifyUserByEmail(event, {
            email: "INVITEE@test.invalid",
            type: "team_invite",
            title: "Join",
        });
        await notifyTeamOwner(
            event,
            { id: 10, owner_user_id: 2 },
            {
                type: "team_invite_accepted",
                title: "Joined",
            },
        );
        await createNotification(event.context.drizzle, 3, {
            type: "results_published",
            title: "Results",
            link: "/results",
        });

        const rows = await event.context.drizzle.select().from(notifications);
        expect(rows.map((row) => row.user_id).sort()).toEqual([2, 3, 3]);
    });

    it("ignores an invitation email without an account", async () => {
        await notifyUserByEmail(event, {
            email: "missing@test.invalid",
            type: "team_invite",
            title: "Join",
        });
        expect(await event.context.drizzle.select().from(notifications)).toEqual([]);
    });

    it("weights peer-vote results one unit per voting team", () => {
        const summary = summarizePeerVoting(
            [
                { team_id: 10, name: "A", pathway: "junior" },
                { team_id: 11, name: "B", pathway: "junior" },
                { team_id: 12, name: "C", pathway: "junior" },
            ],
            [
                { user_id: 1, team_id: 20, score: JSON.stringify({ 10: 5, 11: 1 }) },
                { user_id: 2, team_id: 20, score: JSON.stringify({ 10: 1, 11: 5 }) },
                { user_id: 3, team_id: 21, score: JSON.stringify({ 10: 3, 11: 3 }) },
                { user_id: 4, team_id: null, score: JSON.stringify({ 10: 5 }) },
            ],
        );

        expect(summary.votingTeams).toBe(2);
        expect(summary.ballots).toBe(4);
        expect(summary.projects).toEqual([
            { team_id: 10, average_stars: 3, team_units: 2 },
            { team_id: 11, average_stars: 3, team_units: 2 },
            { team_id: 12, average_stars: 0, team_units: 0 },
        ]);
    });
});
