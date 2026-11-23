import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
    createTestContext,
    mockBody,
    mockSession,
    resetMockState,
    resetTestContext,
    setupNitroGlobals,
    type TestContext,
} from "../api/helpers";
import { users } from "~~/server/database/schema";

let ctx: TestContext;
let deleteHandler: any;
let getUser: typeof import("~~/server/utils/database/users").getUser;

function addUser(email: string, isAdmin = 0) {
    return ctx.drizzle.insert(users).values({ email, is_admin: isAdmin }).returning().get();
}

function event() {
    return { context: { drizzle: ctx.drizzle } };
}

beforeAll(async () => {
    setupNitroGlobals();
    ({ getUser } = await import("~~/server/utils/database/users"));
    vi.stubGlobal("getUser", getUser);
    deleteHandler = (await import("~~/server/api/users/index.delete")).default;
});

beforeEach(async () => {
    resetMockState();
    ctx = await createTestContext();
});

afterEach(() => {
    resetTestContext(ctx);
});

describe("INITIAL_ADMIN_EMAILS parsing", () => {
    it("normalizes, trims, and deduplicates the configured allowlist", async () => {
        const { parseInitialAdminEmails } = await import("~~/server/utils/initial-admins");

        expect(parseInitialAdminEmails(" Admin@Example.com, second@example.com ,, ")).toEqual([
            "admin@example.com",
            "second@example.com",
        ]);
        expect(parseInitialAdminEmails("admin@example.com,ADMIN@example.com")).toEqual([
            "admin@example.com",
        ]);
        expect(parseInitialAdminEmails("")).toEqual([]);
    });

    it("uses the environment allowlist and falls back only when it is unset", async () => {
        vi.resetModules();
        try {
            process.env.INITIAL_ADMIN_EMAILS = " First@Example.com ,second@example.com ";
            const configured = await import("~~/server/utils/initial-admins");
            expect(configured.INITIAL_ADMIN_EMAILS).toEqual([
                "first@example.com",
                "second@example.com",
            ]);
            expect(configured.isInitialAdminEmail(" FIRST@EXAMPLE.COM ")).toBe(true);
            expect(configured.isInitialAdminEmail("cindy.cheng-bisz@basischina.com")).toBe(false);

            delete process.env.INITIAL_ADMIN_EMAILS;
            vi.resetModules();
            const fallback = await import("~~/server/utils/initial-admins");
            expect(fallback.isInitialAdminEmail("Cindy.Cheng-Bisz@basischina.com")).toBe(true);
        } finally {
            delete process.env.INITIAL_ADMIN_EMAILS;
            vi.resetModules();
        }
    });
});

describe("demoted administrators lose the effective grant", () => {
    it("ignores the configured allowlist once local admin state is known", async () => {
        const { hasEffectiveNethackPermission } =
            await import("~~/server/utils/effective-permissions");
        const { NethackPermissions } = await import("~~/shared/permissions");
        const email = "cindy.cheng-bisz@basischina.com";

        expect(
            hasEffectiveNethackPermission([], NethackPermissions.Users.delete, {
                email,
                is_admin: 1,
            }),
        ).toBe(true);
        expect(
            hasEffectiveNethackPermission([], NethackPermissions.Users.delete, {
                email,
                is_admin: 0,
            }),
        ).toBe(false);
        expect(hasEffectiveNethackPermission([], NethackPermissions.Users.delete, { email })).toBe(
            true,
        );
    });
});

describe("DELETE /api/users administrator rotation", () => {
    it("allows another administrator to delete an initial administrator", async () => {
        const actor = addUser("operator@example.test", 1);
        const target = addUser("cindy.cheng-bisz@basischina.com", 1);
        mockSession.value = { user: { id: actor.id } };
        mockBody.value = { ids: [target.id] };

        await expect(deleteHandler(event())).resolves.toEqual({ message: "Deleted 1 user(s)" });
        expect(
            ctx.drizzle.select().from(users).where(eq(users.id, target.id)).get(),
        ).toBeUndefined();
        expect(ctx.drizzle.select().from(users).where(eq(users.id, actor.id)).get()).toBeDefined();
    });

    it("rejects deleting yourself", async () => {
        const actor = addUser("operator@example.test", 1);
        addUser("other-admin@example.test", 1);
        mockSession.value = { user: { id: actor.id } };
        mockBody.value = { ids: [actor.id] };

        await expect(deleteHandler(event())).rejects.toMatchObject({
            statusCode: 403,
            message: "You cannot delete yourself",
        });
        expect(ctx.drizzle.select().from(users).where(eq(users.id, actor.id)).get()).toBeDefined();
    });

    it("rejects deleting the last remaining administrator", async () => {
        const actor = addUser("operator@example.test", 0);
        const target = addUser("only-admin@example.test", 1);
        mockSession.value = { user: { id: actor.id } };
        mockBody.value = { ids: [target.id] };

        await expect(deleteHandler(event())).rejects.toMatchObject({
            statusCode: 403,
            message: "At least one administrator must remain",
        });
        expect(ctx.drizzle.select().from(users).where(eq(users.id, target.id)).get()).toBeDefined();
    });

    it("deletes regular users while an administrator remains", async () => {
        const actor = addUser("operator@example.test", 1);
        const target = addUser("user@example.test");
        mockSession.value = { user: { id: actor.id } };
        mockBody.value = { ids: [target.id] };

        await expect(deleteHandler(event())).resolves.toEqual({ message: "Deleted 1 user(s)" });
        expect(
            ctx.drizzle.select().from(users).where(eq(users.id, target.id)).get(),
        ).toBeUndefined();
    });
});
