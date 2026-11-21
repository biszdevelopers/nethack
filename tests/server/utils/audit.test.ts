import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestContext, resetTestContext, type TestContext } from "~~/tests/api/helpers";
import { adminAuditEvents } from "~~/server/database/schema";

const getRequestHeader = vi.hoisted(() => vi.fn());

vi.mock("h3", async (importOriginal) => {
    const actual = await importOriginal<typeof import("h3")>();
    return { ...actual, getRequestHeader };
});

const { auditActorId, writeAuditEvent } = await import("~~/server/utils/audit");

let ctx: TestContext;

beforeEach(async () => {
    ctx = await createTestContext();
    getRequestHeader.mockReset();
});

afterEach(() => {
    resetTestContext(ctx);
});

function createEvent(context: Record<string, unknown> = {}) {
    return { context } as any;
}

describe("auditActorId", () => {
    it("prefers the middleware-validated basis-auth user", () => {
        const event = createEvent({
            basisAuthValidatedUser: { user: { id: 7 } },
            oauth2: { user: { id: 9 } },
        });

        expect(auditActorId(event)).toBe(7);
    });

    it("falls back to an OAuth2 resource-token user", () => {
        expect(auditActorId(createEvent({ oauth2: { user: { id: 9 } } }))).toBe(9);
    });

    it("returns null for an anonymous request", () => {
        expect(auditActorId(createEvent())).toBeNull();
    });
});

describe("writeAuditEvent", () => {
    it("stores the actor, entity, payloads, and a trimmed request id", async () => {
        getRequestHeader.mockImplementation((_event, name) =>
            name === "x-request-id" ? "  req-123  " : undefined,
        );
        const event = createEvent({ basisAuthValidatedUser: { user: { id: 4 } } });

        await writeAuditEvent(ctx.drizzle as any, event, {
            action: "team.reopen",
            entity_type: "team",
            entity_id: 12,
            before: { project_submitted: 1 },
            after: { project_submitted: 0 },
            reason: "mistake",
        });

        const row = ctx.drizzle.select().from(adminAuditEvents).all()[0]!;
        expect(row).toMatchObject({
            actor_user_id: 4,
            action: "team.reopen",
            entity_type: "team",
            entity_id: "12",
            before: { project_submitted: 1 },
            after: { project_submitted: 0 },
            reason: "mistake",
            request_id: "req-123",
        });
        expect(row.created_at).toBeInstanceOf(Date);
    });

    it("falls back to the correlation header and truncates long ids", async () => {
        getRequestHeader.mockImplementation((_event, name) =>
            name === "x-correlation-id" ? "c".repeat(250) : undefined,
        );

        await writeAuditEvent(ctx.drizzle as any, createEvent(), {
            action: "award.delete",
            entity_type: "award",
            entity_id: "gold",
        });

        const row = ctx.drizzle.select().from(adminAuditEvents).all()[0]!;
        expect(row.request_id).toBe("c".repeat(200));
    });

    it("stores nulls when no request header or optional fields are available", async () => {
        getRequestHeader.mockReturnValue(undefined);

        await writeAuditEvent(ctx.drizzle as any, createEvent(), {
            action: "award.delete",
            entity_type: "award",
            entity_id: null,
        });

        expect(ctx.drizzle.select().from(adminAuditEvents).all()[0]).toMatchObject({
            actor_user_id: null,
            entity_id: null,
            before: null,
            after: null,
            reason: null,
            request_id: null,
        });
    });

    it("ignores whitespace-only request ids", async () => {
        getRequestHeader.mockReturnValue("   ");

        await writeAuditEvent(ctx.drizzle as any, createEvent(), {
            action: "team.status",
            entity_type: "team",
        });

        expect(ctx.drizzle.select().from(adminAuditEvents).all()[0]!.request_id).toBeNull();
    });

    it("survives a request object that cannot expose headers", async () => {
        getRequestHeader.mockImplementation(() => {
            throw new Error("not an H3 event");
        });

        await writeAuditEvent(ctx.drizzle as any, createEvent(), {
            action: "team.status",
            entity_type: "team",
            entity_id: undefined,
        });

        expect(ctx.drizzle.select().from(adminAuditEvents).all()[0]).toMatchObject({
            request_id: null,
            entity_id: null,
        });
    });
});
