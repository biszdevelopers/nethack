import { Readable } from "node:stream";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
    createTestContext,
    mockBody,
    mockParams,
    mockSession,
    resetMockState,
    resetTestContext,
    seedHackathon,
    seedSeason,
    seedUser,
    setupNitroGlobals,
    type TestContext,
} from "./helpers";
import { eq } from "drizzle-orm";
import { users } from "~~/server/database/schema";

const mocks = vi.hoisted(() => ({
    createUserAsset: vi.fn(),
    removeUserAsset: vi.fn(),
    clearSession: vi.fn(),
}));

vi.mock("~~/server/utils/assets", () => ({
    createUserAsset: mocks.createUserAsset,
    removeUserAsset: mocks.removeUserAsset,
}));
vi.mock("~~/server/utils/basis-auth-session", () => ({
    clearBasisAuthUserSession: mocks.clearSession,
}));
vi.mock("~~/server/utils/rateLimit", () => ({
    applyRateLimit: (handler: (event: unknown) => unknown) => handler,
}));

let ctx: TestContext;
let handler: any;

beforeAll(async () => {
    setupNitroGlobals();
    const validate = (schema: any, value: unknown) =>
        typeof schema === "function" ? schema(value) : schema.parse(value);
    vi.stubGlobal("readValidatedBody", async (_event: unknown, schema: any) =>
        validate(schema, mockBody.value),
    );
    const usersDb = await import("~~/server/utils/database/users");
    vi.stubGlobal("getUser", usersDb.getUser);
    vi.stubGlobal("updateUserName", usersDb.updateUserName);
    vi.stubGlobal("updateUserProfileTheme", usersDb.updateUserProfileTheme);
    vi.stubGlobal("updateUserProfilePicture", usersDb.updateUserProfilePicture);
    handler = (await import("~~/server/api/users/[id]/index.patch")).default;
});

beforeEach(async () => {
    resetMockState();
    vi.clearAllMocks();
    mocks.createUserAsset.mockResolvedValue("stored/new-image.png");
    mocks.removeUserAsset.mockResolvedValue(undefined);
    ctx = await createTestContext();
    const usersDb = await import("~~/server/utils/database/users");
    vi.stubGlobal("getUser", usersDb.getUser);
    seedHackathon(ctx);
    seedSeason(ctx);
    const user = seedUser(ctx, { email: "profile-owner@basischina.com", name: "Profile Owner" });
    mockSession.value = { user: { id: user.id } };
    mockParams.values.id = String(user.id);
});

afterEach(() => {
    resetTestContext(ctx);
});

function makeEvent(options: { encoding?: string; contentLength?: string } = {}) {
    const bytes = Buffer.from(JSON.stringify(mockBody.value ?? {}));
    const request = Object.assign(Readable.from([bytes]), {
        headers: {
            "content-length": options.contentLength ?? String(bytes.byteLength),
            "content-type": "application/json",
            ...(options.encoding ? { "content-encoding": options.encoding } : {}),
        },
        socket: { remoteAddress: "127.0.0.1" },
        pause: vi.fn(),
    });
    return {
        context: { drizzle: ctx.drizzle },
        node: { req: request, res: { headersSent: false, setHeader: vi.fn() } },
    };
}

function owner() {
    return ctx.drizzle.select().from(users).where(eq(users.id, 1)).get()!;
}

function dataUrl(mime: string, bytes: number[]) {
    return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

describe("PATCH /api/users/:id profile action edges", () => {
    it("stores validated theme and avatar images and replaces previous assets", async () => {
        ctx.drizzle
            .update(users)
            .set({ profile_theme: "url|old-theme.png", profile_picture: "old-avatar.png" })
            .where(eq(users.id, 1))
            .run();
        mocks.createUserAsset
            .mockResolvedValueOnce("stored/theme.png")
            .mockResolvedValueOnce("stored/avatar.webp");
        mockBody.value = {
            profile_theme_image: dataUrl("image/png", [137, 80, 78, 71, 13, 10, 26, 10]),
            avatar: dataUrl("image/webp", [82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]),
        };

        await expect(handler(makeEvent())).resolves.toEqual({ message: "Your profile is updated" });

        const saved = owner();
        expect(saved.profile_theme).toBe("url|stored/theme.png");
        expect(saved.profile_picture).toBe("stored/avatar.webp");
        expect(mocks.removeUserAsset).toHaveBeenNthCalledWith(1, "old-theme.png");
        expect(mocks.removeUserAsset).toHaveBeenNthCalledWith(2, "old-avatar.png");
        expect(mocks.createUserAsset).toHaveBeenCalledTimes(2);
        expect(mocks.createUserAsset.mock.calls[0][0]).toMatch(/\.png$/);
        expect(mocks.createUserAsset.mock.calls[1][0]).toMatch(/\.webp$/);
    });

    it("removes old theme and avatar assets when both values are cleared", async () => {
        ctx.drizzle
            .update(users)
            .set({ profile_theme: "url|old-theme.png", profile_picture: "old-avatar.jpg" })
            .where(eq(users.id, 1))
            .run();
        mockBody.value = { profile_theme_image: null, avatar: null };

        await handler(makeEvent());

        expect(owner().profile_theme).toBeNull();
        expect(owner().profile_picture).toBeNull();
        expect(mocks.removeUserAsset.mock.calls).toEqual([["old-theme.png"], ["old-avatar.jpg"]]);
        expect(mocks.createUserAsset).not.toHaveBeenCalled();
    });

    it.each([
        ["missing data URL separator", "data:image/png;base64"],
        ["malformed image header", "data:image/png;extra;base64,AAAA"],
        ["unsupported image type", "data:image/svg+xml;base64,PHN2Zz4="],
        ["empty base64 payload", "data:image/png;base64,"],
        ["non-base64 alphabet character", "data:image/png;base64,AQ*D"],
        ["invalid base64 padding bits", "data:image/png;base64,AB=="],
        ["invalid single-padding bits", "data:image/png;base64,AAB="],
        ["content that does not match the declared type", "data:image/png;base64,AQID"],
    ])("rejects %s before writing an asset", async (_label, value) => {
        mockBody.value = { avatar: value };

        await expect(handler(makeEvent())).rejects.toThrow();
        expect(mocks.createUserAsset).not.toHaveBeenCalled();
    });

    it("rejects profile images above the decoded file limit", async () => {
        const oversizedBase64 = "A".repeat(Math.ceil((7 * 1024 * 1024) / 3) * 4 + 4);
        mockBody.value = { avatar: `data:image/png;base64,${oversizedBase64}` };

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 413 });
        expect(mocks.createUserAsset).not.toHaveBeenCalled();
    });

    it("enforces the decoded limit when encoded length is exactly at its upper bound", async () => {
        const maximumEncodedLength = Math.ceil((7 * 1024 * 1024) / 3) * 4;
        mockBody.value = {
            avatar: `data:image/png;base64,${"A".repeat(maximumEncodedLength)}`,
        };

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 413 });
        expect(mocks.createUserAsset).not.toHaveBeenCalled();
    });

    it.each([
        ["JPEG slash alphabet", "image/jpeg", [255, 216, 255]],
        ["JPEG plus alphabet", "image/jpeg", [255, 216, 255, 0, 0, 62]],
        ["JPEG digit alphabet", "image/jpeg", [255, 216, 255, 0, 0, 52]],
        ["GIF signature", "image/gif", [71, 73, 70, 56, 57, 97]],
    ])("accepts %s with a matching signature", async (_label, mime, bytes) => {
        mockBody.value = { avatar: dataUrl(mime, bytes) };

        await expect(handler(makeEvent())).resolves.toEqual({ message: "Your profile is updated" });
        expect(owner().profile_picture).toBe("stored/new-image.png");
        expect(mocks.createUserAsset).toHaveBeenCalledOnce();
    });

    it("rejects compressed request bodies before parsing profile data", async () => {
        mockBody.value = { name: "Updated" };

        await expect(handler(makeEvent({ encoding: "gzip" }))).rejects.toMatchObject({
            statusCode: 415,
        });
        expect(owner().name).toBe("Profile Owner");
    });

    it("rejects an oversized request based on its declared content length", async () => {
        mockBody.value = { name: "Updated" };

        await expect(
            handler(makeEvent({ contentLength: String(10 * 1024 * 1024 + 1) })),
        ).rejects.toMatchObject({
            statusCode: 413,
        });
        expect(owner().name).toBe("Profile Owner");
    });

    it("rejects invalid user IDs, missing authentication, and edits to another user's profile", async () => {
        mockParams.values.id = "0";
        await expect(handler(makeEvent())).rejects.toThrow();

        mockParams.values.id = "1";
        mockSession.value = undefined;
        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 401 });

        mockSession.value = { user: { id: 1 } };
        mockParams.values.id = "2";
        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 403 });
    });

    it("clears the stale session when the authenticated user disappears", async () => {
        mockParams.values.id = "9999";
        mockSession.value = { user: { id: 9999 } };
        mockBody.value = { name: "Updated" };
        (globalThis as any).requireUser.mockResolvedValue({ id: 9999, role: "participant" });
        vi.stubGlobal("getUser", vi.fn().mockResolvedValue(undefined));

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 401 });
        expect(mocks.clearSession).toHaveBeenCalledOnce();
    });

    it("rejects a display name that exceeds the request schema limit", async () => {
        mockBody.value = { name: "x".repeat(51) };

        await expect(handler(makeEvent())).rejects.toThrow();
        expect(owner().name).toBe("Profile Owner");
    });
});
