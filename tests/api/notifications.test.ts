import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
    createTestContext,
    mockParams,
    mockQueryState,
    mockSession,
    resetMockState,
    resetTestContext,
    seedHackathon,
    seedSeason,
    seedTeam,
    seedUser,
    setupNitroGlobals,
    type TestContext,
} from "./helpers";
import { notifications } from "~~/server/database/schema";
import {
    createNotification,
    deleteNotificationsForUsers,
    notifySeasonParticipants,
    notifyTeamOwner,
    notifyUserByEmail,
} from "~~/server/utils/notifications";

vi.mock("~~/server/utils/rateLimit", () => ({
    applyRateLimit: (fn: any) => fn,
    DEFAULT_RATE_LIMIT_CONFIG: { maxRequests: 6000, windowMs: 60 * 1000 },
}));

let ctx: TestContext;
let listNotifications: any;
let readAll: any;
let readOne: any;

beforeAll(async () => {
    setupNitroGlobals();
    listNotifications = (await import("~~/server/api/notifications/index.get")).default;
    readAll = (await import("~~/server/api/notifications/read-all.patch")).default;
    readOne = (await import("~~/server/api/notifications/[id]/read.patch")).default;
});

beforeEach(async () => {
    resetMockState();
    ctx = await createTestContext();
    seedHackathon(ctx);
    seedSeason(ctx);
});

afterEach(() => {
    resetTestContext(ctx);
});

function createEvent(overrides: Record<string, unknown> = {}) {
    return { context: { drizzle: ctx.drizzle }, ...overrides };
}

function seedNotification(userId: number, overrides: Record<string, unknown> = {}) {
    return ctx.drizzle
        .insert(notifications)
        .values({
            user_id: userId,
            type: "team_invite",
            title: "Invitation",
            body: "Join the team",
            link: "/dashboard",
            read_at: null,
            created_at: new Date(),
            ...overrides,
        } as any)
        .returning()
        .get();
}

describe("GET /api/notifications", () => {
    it("requires an authenticated user", async () => {
        mockQueryState.value = { limit: 50 };

        await expect(listNotifications(createEvent())).rejects.toMatchObject({ statusCode: 401 });
    });

    it("returns only the current user's notifications with the unread count", async () => {
        const user = seedUser(ctx, { email: "user@basischina.com" });
        const other = seedUser(ctx, { email: "other@basischina.com" });
        const read = seedNotification(user.id, {
            title: "Old",
            read_at: new Date(),
            created_at: new Date(Date.now() - 1000),
        });
        const newest = seedNotification(user.id, { title: "New" });
        seedNotification(other.id, { title: "Not mine" });
        mockSession.value = { user: { id: user.id } };
        mockQueryState.value = { limit: 50 };

        const result = await listNotifications(createEvent());

        expect(result.notifications.map((row: any) => row.id)).toEqual([newest.id, read.id]);
        expect(result.unread).toBe(1);
        expect(result.notifications[0]).toMatchObject({
            id: newest.id,
            type: "team_invite",
            title: "New",
            body: "Join the team",
            link: "/dashboard",
            read_at: null,
            created_at: newest.created_at.toISOString(),
        });
        expect(result.notifications[1].read_at).toBe(read.read_at!.toISOString());
    });

    it("honours the limit and reports zero for an empty inbox", async () => {
        const user = seedUser(ctx, { email: "user@basischina.com" });
        seedNotification(user.id, { title: "First" });
        seedNotification(user.id, { title: "Second" });
        mockSession.value = { user: { id: user.id } };
        mockQueryState.value = { limit: 1 };

        const limited = await listNotifications(createEvent());
        expect(limited.notifications).toHaveLength(1);

        mockQueryState.value = { limit: 50 };
        ctx.drizzle.delete(notifications).run();
        await expect(listNotifications(createEvent())).resolves.toMatchObject({
            notifications: [],
            unread: 0,
        });
    });

    it("falls back to zero when the unread count query returns no row", async () => {
        const fakeDrizzle = {
            select: () => ({
                from: () => {
                    const chain: any = {
                        where: () => chain,
                        orderBy: () => chain,
                        limit: () => Promise.resolve([]),
                        then: (resolve: any) => resolve([]),
                    };
                    return chain;
                },
            }),
        };
        vi.mocked(globalThis.requireUser).mockResolvedValueOnce({ id: 1 } as any);
        mockQueryState.value = { limit: 50 };

        const result = await listNotifications(createEvent({ context: { drizzle: fakeDrizzle } }));

        expect(result).toEqual({ notifications: [], unread: 0 });
    });
});

describe("PATCH /api/notifications/read-all", () => {
    it("requires an authenticated user", async () => {
        await expect(readAll(createEvent())).rejects.toMatchObject({ statusCode: 401 });
    });

    it("marks only the current user's unread notifications as read", async () => {
        const user = seedUser(ctx, { email: "user@basischina.com" });
        const other = seedUser(ctx, { email: "other@basischina.com" });
        const alreadyRead = seedNotification(user.id, { read_at: new Date(0) });
        seedNotification(user.id, { title: "Unread" });
        seedNotification(other.id);
        mockSession.value = { user: { id: user.id } };

        await expect(readAll(createEvent())).resolves.toEqual({
            message: "All notifications marked read",
        });

        const rows = ctx.drizzle.select().from(notifications).all();
        expect(rows.filter((row) => row.user_id === user.id && row.read_at === null)).toHaveLength(
            0,
        );
        expect(rows.find((row) => row.id === alreadyRead.id)!.read_at).toEqual(new Date(0));
        expect(rows.filter((row) => row.user_id === other.id && row.read_at === null)).toHaveLength(
            1,
        );
    });
});

describe("PATCH /api/notifications/:id/read", () => {
    it("requires an authenticated user", async () => {
        mockParams.values = { id: 1 };

        await expect(readOne(createEvent())).rejects.toMatchObject({ statusCode: 401 });
    });

    it("marks one owned notification as read", async () => {
        const user = seedUser(ctx, { email: "user@basischina.com" });
        const notice = seedNotification(user.id);
        mockSession.value = { user: { id: user.id } };
        mockParams.values = { id: notice.id };

        await expect(readOne(createEvent())).resolves.toEqual({
            message: "Notification marked read",
        });

        expect(ctx.drizzle.select().from(notifications).all()[0]!.read_at).toBeInstanceOf(Date);
    });

    it("returns 404 for a missing or foreign notification", async () => {
        const user = seedUser(ctx, { email: "user@basischina.com" });
        const other = seedUser(ctx, { email: "other@basischina.com" });
        const foreign = seedNotification(other.id);
        mockSession.value = { user: { id: user.id } };
        mockParams.values = { id: foreign.id };

        await expect(readOne(createEvent())).rejects.toMatchObject({
            statusCode: 404,
            message: "Notification not found",
        });

        mockParams.values = { id: 999 };
        await expect(readOne(createEvent())).rejects.toMatchObject({ statusCode: 404 });
    });
});

describe("notification delivery helpers", () => {
    it("creates a notification with optional body and link", async () => {
        const user = seedUser(ctx, { email: "user@basischina.com" });

        await createNotification(ctx.drizzle as any, user.id, { type: "system", title: "Hello" });

        expect(ctx.drizzle.select().from(notifications).all()[0]).toMatchObject({
            user_id: user.id,
            type: "system",
            title: "Hello",
            body: null,
            link: null,
        });

        await createNotification(ctx.drizzle as any, user.id, {
            type: "system",
            title: "Linked",
            body: "Body",
            link: "/notifications",
        });
        expect(ctx.drizzle.select().from(notifications).all()[1]).toMatchObject({
            body: "Body",
            link: "/notifications",
        });
    });

    it("skips every write when notifications are disabled", async () => {
        vi.stubEnv("NOTIFICATIONS_ENABLED", "0");
        const user = seedUser(ctx, { email: "user@basischina.com" });
        const team = seedTeam(ctx, { name: "Submitted", project_submitted: 1 });
        seedUser(ctx, { email: "member@basischina.com", team_id: team.id });

        try {
            await createNotification(ctx.drizzle as any, user.id, {
                type: "system",
                title: "Hello",
            });
            await expect(
                notifySeasonParticipants(createEvent(), 1, {
                    type: "results_published",
                    title: "Results",
                }),
            ).resolves.toBe(0);
        } finally {
            vi.unstubAllEnvs();
        }

        expect(ctx.drizzle.select().from(notifications).all()).toHaveLength(0);
    });

    it("notifies an existing account by case-insensitive email", async () => {
        const target = seedUser(ctx, { email: "Person@Basischina.com" });

        await notifyUserByEmail(createEvent(), {
            email: "  person@basischina.COM ",
            type: "team_invite",
            title: "Invitation",
        });

        expect(ctx.drizzle.select().from(notifications).all()).toMatchObject([
            { user_id: target.id, type: "team_invite", title: "Invitation" },
        ]);
    });

    it("skips delivery when no account owns the invited email", async () => {
        await notifyUserByEmail(createEvent(), {
            email: "nobody@basischina.com",
            type: "team_invite",
            title: "Invitation",
        });

        expect(ctx.drizzle.select().from(notifications).all()).toHaveLength(0);
    });

    it("notifies a team owner directly when ownership is recorded", async () => {
        const owner = seedUser(ctx, { email: "owner@basischina.com" });
        const team = seedTeam(ctx, { name: "Owned Team", owner_user_id: owner.id });

        await notifyTeamOwner(
            createEvent(),
            { id: team.id, owner_user_id: owner.id },
            { type: "team_invite_accepted", title: "Someone joined" },
        );

        expect(ctx.drizzle.select().from(notifications).all()).toMatchObject([
            { user_id: owner.id, title: "Someone joined" },
        ]);
    });

    it("falls back to the earliest member of an ownerless team", async () => {
        const team = seedTeam(ctx, { name: "Legacy Team" });
        const first = seedUser(ctx, { email: "first@basischina.com", team_id: team.id });
        seedUser(ctx, { email: "second@basischina.com", team_id: team.id });

        await notifyTeamOwner(
            createEvent(),
            { id: team.id, owner_user_id: null },
            { type: "team_invite_accepted", title: "Someone joined" },
        );

        expect(ctx.drizzle.select().from(notifications).all()).toMatchObject([
            { user_id: first.id },
        ]);
    });

    it("does not notify anyone when an ownerless team has no members", async () => {
        const team = seedTeam(ctx, { name: "Empty Team" });

        await notifyTeamOwner(
            createEvent(),
            { id: team.id, owner_user_id: null },
            { type: "team_invite_accepted", title: "Someone joined" },
        );

        expect(ctx.drizzle.select().from(notifications).all()).toHaveLength(0);
    });

    it("returns zero participants when no team submitted a project", async () => {
        const team = seedTeam(ctx, { name: "Draft Team", project_submitted: 0 });
        seedUser(ctx, { email: "draft@basischina.com", team_id: team.id });

        await expect(
            notifySeasonParticipants(createEvent(), 1, {
                type: "results_published",
                title: "Results",
            }),
        ).resolves.toBe(0);
        expect(ctx.drizzle.select().from(notifications).all()).toHaveLength(0);
    });

    it("batches delivery to every member of a submitted season", async () => {
        const submitted = seedTeam(ctx, { name: "Submitted", project_submitted: 1 });
        const draft = seedTeam(ctx, { name: "Draft", project_submitted: 0 });
        const memberIds: number[] = [];
        for (let index = 0; index < 251; index += 1) {
            memberIds.push(
                seedUser(ctx, {
                    email: `member-${index}@basischina.com`,
                    team_id: submitted.id,
                }).id,
            );
        }
        seedUser(ctx, { email: "draft@basischina.com", team_id: draft.id });

        await expect(
            notifySeasonParticipants(createEvent(), 1, {
                type: "results_published",
                title: "Results are published",
                body: "Feedback is ready",
                link: "/dashboard/results",
            }),
        ).resolves.toBe(251);

        const rows = ctx.drizzle.select().from(notifications).all();
        expect(rows).toHaveLength(251);
        expect(new Set(rows.map((row) => row.user_id)).size).toBe(251);
        expect(rows.every((row) => row.type === "results_published")).toBe(true);
    });

    it("omits optional notification fields for participants", async () => {
        const team = seedTeam(ctx, { name: "Submitted", project_submitted: 1 });
        seedUser(ctx, { email: "member@basischina.com", team_id: team.id });

        await notifySeasonParticipants(createEvent(), 1, {
            type: "results_published",
            title: "Results",
        });

        expect(ctx.drizzle.select().from(notifications).all()[0]).toMatchObject({
            body: null,
            link: null,
        });
    });

    it("skips an empty defensive batch without writing", async () => {
        const team = seedTeam(ctx, { name: "Submitted", project_submitted: 1 });
        seedUser(ctx, { email: "member@basischina.com", team_id: team.id });
        // Simulate the defensive empty-batch guard: the real batching loop can
        // never produce an empty 250-row slice for a non-empty id list.
        const originalSlice = Array.prototype.slice;
        Array.prototype.slice = function (this: unknown[], start?: number, end?: number) {
            if (this.length === 1 && start === 0 && end === 250) return [] as never[];
            return originalSlice.call(this, start, end);
        };

        try {
            await notifySeasonParticipants(createEvent(), 1, {
                type: "results_published",
                title: "Results",
            });
        } finally {
            Array.prototype.slice = originalSlice;
        }

        expect(ctx.drizzle.select().from(notifications).all()).toHaveLength(0);
    });

    it("deletes notifications for removed users in bulk", async () => {
        const first = seedUser(ctx, { email: "first@basischina.com" });
        const second = seedUser(ctx, { email: "second@basischina.com" });
        seedNotification(first.id);
        seedNotification(second.id);

        await deleteNotificationsForUsers(ctx.drizzle as any, []);
        expect(ctx.drizzle.select().from(notifications).all()).toHaveLength(2);

        await deleteNotificationsForUsers(ctx.drizzle as any, [first.id]);
        const rows = ctx.drizzle.select().from(notifications).all();
        expect(rows.map((row) => row.user_id)).toEqual([second.id]);
    });

    it("posts a notification copy to a configured HTTPS webhook", async () => {
        const user = seedUser(ctx, { email: "webhook@basischina.com" });
        const fetchMock = vi.fn().mockResolvedValue({ ok: true });
        vi.stubGlobal("fetch", fetchMock);
        const original = process.env.NOTIFICATION_WEBHOOK_URL;
        process.env.NOTIFICATION_WEBHOOK_URL = "https://hooks.example.test/notify";
        try {
            await createNotification(ctx.drizzle as any, user.id, {
                type: "results_published",
                title: "Results are live",
                link: "/results",
            });
            expect(fetchMock).toHaveBeenCalledOnce();
            const [, options] = fetchMock.mock.calls[0]!;
            expect(JSON.parse(options.body)).toMatchObject({
                type: "results_published",
                link: "/results",
            });
        } finally {
            if (original === undefined) delete process.env.NOTIFICATION_WEBHOOK_URL;
            else process.env.NOTIFICATION_WEBHOOK_URL = original;
            vi.unstubAllGlobals();
        }
    });

    it("skips invalid or insecure webhook URLs", async () => {
        const user = seedUser(ctx, { email: "nowebhook@basischina.com" });
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        const original = process.env.NOTIFICATION_WEBHOOK_URL;
        try {
            for (const value of [
                "not-a-url",
                "http://insecure.example.test",
                "https://user:pass@example.test",
            ]) {
                process.env.NOTIFICATION_WEBHOOK_URL = value;
                await createNotification(ctx.drizzle as any, user.id, {
                    type: "invite",
                    title: "Invite",
                });
            }
            expect(fetchMock).not.toHaveBeenCalled();
        } finally {
            if (original === undefined) delete process.env.NOTIFICATION_WEBHOOK_URL;
            else process.env.NOTIFICATION_WEBHOOK_URL = original;
            vi.unstubAllGlobals();
        }
    });

    it("ignores a rejected webhook without failing the notification", async () => {
        const user = seedUser(ctx, { email: "webhook-fail@basischina.com" });
        const fetchMock = vi.fn().mockRejectedValue(new Error("webhook offline"));
        vi.stubGlobal("fetch", fetchMock);
        const original = process.env.NOTIFICATION_WEBHOOK_URL;
        process.env.NOTIFICATION_WEBHOOK_URL = "https://hooks.example.test/notify";
        try {
            await createNotification(ctx.drizzle as any, user.id, {
                type: "invite",
                title: "Invite",
            });
            await new Promise((resolve) => setImmediate(resolve));
            expect(fetchMock).toHaveBeenCalledOnce();
        } finally {
            if (original === undefined) delete process.env.NOTIFICATION_WEBHOOK_URL;
            else process.env.NOTIFICATION_WEBHOOK_URL = original;
            vi.unstubAllGlobals();
        }
    });
});
