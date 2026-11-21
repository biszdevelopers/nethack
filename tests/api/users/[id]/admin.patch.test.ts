import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
    createTestContext,
    mockBody,
    mockParams,
    resetMockState,
    resetTestContext,
    setupNitroGlobals,
    type TestContext,
} from "../../helpers";
import { users } from "~~/server/database/schema";

const mocks = vi.hoisted(() => ({ requireUser: vi.fn() }));

vi.mock("~~/server/utils/auth", () => ({ requireUser: mocks.requireUser }));
vi.mock("~~/server/utils/rateLimit", () => ({
    applyRateLimit: (handler: unknown) => handler,
    DEFAULT_RATE_LIMIT_CONFIG: {},
}));

let ctx: TestContext;
let handler: any;
let actorId: number;

function addUser(email: string, isAdmin = 0) {
    return ctx.drizzle.insert(users).values({ email, is_admin: isAdmin }).returning().get();
}

function event() {
    return { context: { drizzle: ctx.drizzle } };
}

beforeEach(async () => {
    resetMockState();
    setupNitroGlobals();
    ctx = await createTestContext();
    actorId = addUser("operator@example.test", 1).id;
    mocks.requireUser.mockResolvedValue({
        id: actorId,
        email: "operator@example.test",
        is_admin: 1,
    });
    mockBody.value = { is_admin: true };
    handler = (await import("~~/server/api/users/[id]/admin.patch")).default;
});

afterEach(() => {
    resetTestContext(ctx);
});

describe("PATCH /api/users/:id/admin", () => {
    it("promotes and demotes regular users", async () => {
        const target = addUser("user@example.test");
        mockParams.values["id"] = String(target.id);

        mockBody.value = { is_admin: true };
        await expect(handler(event())).resolves.toEqual({ id: target.id, is_admin: true });
        expect(
            ctx.drizzle.select().from(users).where(eq(users.id, target.id)).get()!.is_admin,
        ).toBe(1);

        mockBody.value = { is_admin: false };
        await expect(handler(event())).resolves.toEqual({ id: target.id, is_admin: false });
        expect(
            ctx.drizzle.select().from(users).where(eq(users.id, target.id)).get()!.is_admin,
        ).toBe(0);
    });

    it("allows another administrator to demote an initial administrator", async () => {
        const target = addUser("cindy.cheng-bisz@basischina.com", 1);
        mockParams.values["id"] = String(target.id);
        mockBody.value = { is_admin: false };

        await expect(handler(event())).resolves.toEqual({ id: target.id, is_admin: false });
        expect(
            ctx.drizzle.select().from(users).where(eq(users.id, target.id)).get()!.is_admin,
        ).toBe(0);
    });

    it("rejects self-demotion even when other administrators remain", async () => {
        addUser("other-admin@example.test", 1);
        mockParams.values["id"] = String(actorId);
        mockBody.value = { is_admin: false };

        await expect(handler(event())).rejects.toMatchObject({ statusCode: 403 });
        expect(ctx.drizzle.select().from(users).where(eq(users.id, actorId)).get()!.is_admin).toBe(
            1,
        );
    });

    it("rejects demoting the last remaining administrator", async () => {
        // A bearer/token administrator can manage accounts without owning an
        // administrator row, so the guard has to count the stored accounts.
        ctx.drizzle.update(users).set({ is_admin: 0 }).where(eq(users.id, actorId)).run();
        const target = addUser("only-admin@example.test", 1);
        mocks.requireUser.mockResolvedValue({
            id: 999,
            email: "token-client@example.test",
            is_admin: 0,
        });
        mockParams.values["id"] = String(target.id);
        mockBody.value = { is_admin: false };

        await expect(handler(event())).rejects.toMatchObject({
            statusCode: 403,
            message: "At least one administrator must remain",
        });
        expect(
            ctx.drizzle.select().from(users).where(eq(users.id, target.id)).get()!.is_admin,
        ).toBe(1);
    });

    it("does not count a configured email without a stored admin flag", async () => {
        ctx.drizzle.update(users).set({ is_admin: 0 }).where(eq(users.id, actorId)).run();
        addUser("cindy.cheng-bisz@basischina.com", 0);
        const target = addUser("only-admin@example.test", 1);
        mocks.requireUser.mockResolvedValue({
            id: 999,
            email: "token-client@example.test",
            is_admin: 0,
        });
        mockParams.values["id"] = String(target.id);
        mockBody.value = { is_admin: false };

        await expect(handler(event())).rejects.toMatchObject({
            statusCode: 403,
            message: "At least one administrator must remain",
        });
    });

    it("returns 404 for a missing target", async () => {
        mockParams.values["id"] = "4040";

        await expect(handler(event())).rejects.toMatchObject({ statusCode: 404 });
    });
});
