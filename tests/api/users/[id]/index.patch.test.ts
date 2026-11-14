import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { Readable } from "node:stream";
import {
    createTestContext,
    resetTestContext,
    resetMockState,
    setupNitroGlobals,
    mockBody,
    mockParams,
    mockSession,
    seedHackathon,
    seedSeason,
    seedUser,
    type TestContext,
} from "../../helpers";
import { users } from "~~/server/database/schema";
import { eq } from "drizzle-orm";

const assetMocks = vi.hoisted(() => ({
    failProfileUpdate: false,
}));

vi.mock("~~/server/utils/rateLimit", () => ({
    applyRateLimit: (fn: any) => fn,
    AUTH_RATE_LIMIT_CONFIG: { maxRequests: 600, windowMs: 60 * 1000 },
}));

vi.mock("~~/server/utils/assets", () => {
    const contentAddress = (data: Buffer, extension: string) => {
        const digest = data.toString("hex").padEnd(64, "0").slice(0, 64);
        const canonicalExtension = extension.toLowerCase().replace(/^jpeg$/, "jpg");
        return `profiles/${digest}.${canonicalExtension}`;
    };

    return {
        getUserAssetContentAddress: vi.fn(contentAddress),
        createUserAssetContentAddressed: vi.fn(async (data: Buffer, extension: string) =>
            contentAddress(data, extension),
        ),
        removeUserAsset: vi.fn(),
        withAssetLifecycleLocks: vi.fn((database: any, _paths: string[], callback: any) =>
            database.transaction((transaction: any) => {
                if (!assetMocks.failProfileUpdate) return callback(transaction);
                return callback(
                    new Proxy(transaction, {
                        get(target, property) {
                            if (property === "update") {
                                return (...args: any[]) => {
                                    const query = target.update(...args);
                                    return {
                                        set(values: unknown) {
                                            const builder = query.set(values);
                                            return {
                                                where(...whereArgs: unknown[]) {
                                                    builder.where(...whereArgs).run();
                                                    throw new Error(
                                                        "simulated profile database update failure",
                                                    );
                                                },
                                            };
                                        },
                                    };
                                };
                            }
                            const value = Reflect.get(target, property, target);
                            return typeof value === "function" ? value.bind(target) : value;
                        },
                    }),
                );
            }),
        ),
    };
});

let ctx: TestContext;
let handler: any;
let requestBodyLimit: any;
let createUserAssetContentAddressed: ReturnType<typeof vi.fn>;
let getUserAssetContentAddress: ReturnType<typeof vi.fn>;
let withAssetLifecycleLocks: ReturnType<typeof vi.fn>;
let removeUserAsset: ReturnType<typeof vi.fn>;

beforeAll(async () => {
    setupNitroGlobals();

    const usersDb = await import("~~/server/utils/database/users");
    vi.stubGlobal("getUser", usersDb.getUser);

    const assets = await import("~~/server/utils/assets");
    createUserAssetContentAddressed = assets.createUserAssetContentAddressed as ReturnType<
        typeof vi.fn
    >;
    getUserAssetContentAddress = assets.getUserAssetContentAddress as ReturnType<typeof vi.fn>;
    withAssetLifecycleLocks = assets.withAssetLifecycleLocks as ReturnType<typeof vi.fn>;
    removeUserAsset = assets.removeUserAsset as ReturnType<typeof vi.fn>;

    handler = (await import("~~/server/api/users/[id]/index.patch")).default;
    requestBodyLimit = (await import("~~/server/middleware/01.request-body-limit")).default;
});

beforeEach(async () => {
    resetMockState();
    assetMocks.failProfileUpdate = false;
    createUserAssetContentAddressed?.mockClear();
    getUserAssetContentAddress?.mockClear();
    withAssetLifecycleLocks?.mockClear();
    removeUserAsset?.mockClear();
    ctx = await createTestContext();
    seedHackathon(ctx);
    seedSeason(ctx);
});

afterEach(() => {
    resetTestContext(ctx);
});

function createEvent(overrides: Record<string, unknown> = {}) {
    const body = Buffer.from(JSON.stringify(mockBody.value ?? {}));
    const request = Object.assign(Readable.from([body]), {
        headers: {
            "content-length": String(body.byteLength),
            "content-type": "application/json",
        },
    });

    return {
        context: { drizzle: ctx.drizzle },
        path: `/api/users/${mockParams.values["id"] ?? "1"}`,
        method: "PATCH",
        node: {
            req: request,
            res: { headersSent: false, setHeader() {} },
        },
        ...overrides,
    };
}

function createProfileRequest(body: Buffer, contentLength = body.byteLength) {
    const request = Object.assign(Readable.from([body]), {
        headers: {
            "content-length": String(contentLength),
            "content-type": "application/json",
        },
    });

    return createEvent({
        path: "/api/users/1",
        method: "PATCH",
        node: { req: request },
    });
}

const VALID_PNG_BASE64 =
    "data:image/png;base64," + Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64");
const VALID_JPEG_BASE64 =
    "data:image/jpeg;base64," + Buffer.from([0xff, 0xd8, 0xff]).toString("base64");
const VALID_GIF_BASE64 = "data:image/gif;base64," + Buffer.from("GIF89a").toString("base64");
const VALID_WEBP_BASE64 =
    "data:image/webp;base64," + Buffer.from("RIFF\0\0\0\0WEBP").toString("base64");
const OLD_THEME_ASSET = `profiles/${"a".repeat(64)}.png`;
const OLD_AVATAR_ASSET = `profiles/${"b".repeat(64)}.jpg`;

function tooLargeBase64(): string {
    const oversized = Buffer.alloc(7 * 1024 * 1024 + 1, 0);
    return "data:image/png;base64," + oversized.toString("base64");
}

describe("PATCH /api/users/:id", () => {
    it("does not buffer an oversized profile body before authentication", async () => {
        seedUser(ctx, { email: "viewer@basischina.com" });
        mockParams.values["id"] = "1";
        mockSession.value = null;
        const event = createProfileRequest(Buffer.from(""), 10 * 1024 * 1024 + 1);
        const request = (event as any).node.req;

        await requestBodyLimit(event);
        await expect(handler(event)).rejects.toMatchObject({ statusCode: 401 });

        expect(request.readableEnded).toBe(false);
    });

    it("allows an authenticated profile request above the general API limit", async () => {
        const alice = seedUser(ctx, { email: "alice@basischina.com", name: "Alice" });
        const body = Buffer.from(
            `{\"name\":\"Alice Updated\",\"padding\":\"${"x".repeat(1024 * 1024)}\"}`,
        );
        const event = createProfileRequest(body);
        mockParams.values["id"] = String(alice.id);
        mockSession.value = { user: { id: alice.id } };
        mockBody.value = { name: "Alice Updated" };

        await requestBodyLimit(event);
        await expect(handler(event)).resolves.toEqual({ message: "Your profile is updated" });
    });

    it("returns 403 when updating another user", async () => {
        seedUser(ctx, { email: "viewer@basischina.com" });
        mockParams.values["id"] = "2";
        mockSession.value = { user: { id: 1 } };

        await expect(handler(createEvent())).rejects.toMatchObject({
            statusCode: 403,
            message: "Cannot update other users",
        });
    });

    it("returns 401 when authenticated user no longer exists", async () => {
        mockParams.values["id"] = "9999";
        mockSession.value = { user: { id: 9999 } };
        mockBody.value = { name: "Ghost" };

        await expect(handler(createEvent())).rejects.toMatchObject({
            statusCode: 401,
            message: "Logged in user not found",
        });
    });

    it("updates the user name", async () => {
        const alice = seedUser(ctx, { email: "alice@basischina.com", name: "Alice" });

        mockParams.values["id"] = String(alice.id);
        mockSession.value = { user: { id: alice.id } };
        mockBody.value = { name: "Alice Updated" };

        const result = await handler(createEvent());

        expect(result).toEqual({ message: "Your profile is updated" });

        const updated = ctx.drizzle.select().from(users).where(eq(users.id, alice.id)).get();
        expect(updated!.name).toBe("Alice Updated");
    });

    it("validates every profile image before applying other profile changes", async () => {
        const alice = seedUser(ctx, { email: "alice@basischina.com", name: "Alice" });
        mockParams.values["id"] = String(alice.id);
        mockSession.value = { user: { id: alice.id } };
        mockBody.value = { name: "Should Not Persist", avatar: "not-a-data-url" };

        await expect(handler(createEvent())).rejects.toMatchObject({ statusCode: 400 });

        const unchanged = ctx.drizzle.select().from(users).where(eq(users.id, alice.id)).get();
        expect(unchanged!.name).toBe("Alice");
        expect(withAssetLifecycleLocks).not.toHaveBeenCalled();
    });

    it.each([
        {
            field: "profile_theme_image",
            dataUrl: VALID_PNG_BASE64,
            message: "Published profile theme path does not match its digest",
        },
        {
            field: "avatar",
            dataUrl: VALID_PNG_BASE64,
            message: "Published avatar path does not match its digest",
        },
    ])(
        "rejects a $field publication that does not match its digest",
        async ({ field, dataUrl, message }) => {
            const alice = seedUser(ctx, { email: `alice-${field}@basischina.com`, name: "Alice" });
            mockParams.values["id"] = String(alice.id);
            mockSession.value = { user: { id: alice.id } };
            mockBody.value = { [field]: dataUrl };
            createUserAssetContentAddressed.mockResolvedValueOnce(`profiles/${"f".repeat(64)}.png`);

            await expect(handler(createEvent())).rejects.toThrow(message);

            const unchanged = ctx.drizzle.select().from(users).where(eq(users.id, alice.id)).get();
            expect(unchanged!.profile_picture).toBeNull();
            expect(unchanged!.profile_theme).toBeNull();
        },
    );

    it("returns 404 when the user disappears before the profile update", async () => {
        const alice = seedUser(ctx, { email: "alice-disappeared@basischina.com", name: "Alice" });
        mockParams.values["id"] = String(alice.id);
        mockSession.value = { user: { id: alice.id } };
        mockBody.value = { name: "Updated Alice" };
        withAssetLifecycleLocks.mockImplementationOnce(
            async (
                _database: unknown,
                _paths: string[],
                callback: (transaction: unknown) => unknown,
            ) =>
                callback({
                    update: () => ({
                        set: () => ({
                            where: () => ({ returning: async () => [] }),
                        }),
                    }),
                }),
        );

        await expect(handler(createEvent())).rejects.toMatchObject({
            statusCode: 404,
            message: "User not found",
        });
    });

    describe("profile_theme_image", () => {
        it("clears the existing profile theme reference without deleting its asset", async () => {
            const alice = seedUser(ctx, { email: "alice@basischina.com", name: "Alice" });
            ctx.drizzle
                .update(users)
                .set({ profile_theme: `url|${OLD_THEME_ASSET}` })
                .where(eq(users.id, alice.id))
                .run();

            mockParams.values["id"] = String(alice.id);
            mockSession.value = { user: { id: alice.id } };
            mockBody.value = { profile_theme_image: null };

            const result = await handler(createEvent());

            expect(result).toEqual({ message: "Your profile is updated" });
            expect(withAssetLifecycleLocks).toHaveBeenCalledWith(
                ctx.drizzle,
                [OLD_THEME_ASSET],
                expect.any(Function),
            );
            expect(createUserAssetContentAddressed).not.toHaveBeenCalled();

            const updated = ctx.drizzle.select().from(users).where(eq(users.id, alice.id)).get();
            expect(updated!.profile_theme).toBeNull();
        });

        it("rejects an invalid image data URL format", async () => {
            const alice = seedUser(ctx, { email: "alice@basischina.com", name: "Alice" });

            mockParams.values["id"] = String(alice.id);
            mockSession.value = { user: { id: alice.id } };
            mockBody.value = { profile_theme_image: "not-a-data-url" };

            await expect(handler(createEvent())).rejects.toMatchObject({
                statusCode: 400,
                message: "Invalid image data format. Expected a base64 data URL.",
            });
        });

        it("rejects a data URL without a mime type", async () => {
            const alice = seedUser(ctx, { email: "alice@basischina.com", name: "Alice" });

            mockParams.values["id"] = String(alice.id);
            mockSession.value = { user: { id: alice.id } };
            mockBody.value = { profile_theme_image: "data:;base64,AAAA" };

            await expect(handler(createEvent())).rejects.toMatchObject({
                statusCode: 400,
                message: "Could not determine image type from upload data.",
            });
        });

        it("rejects invalid base64 image data", async () => {
            const alice = seedUser(ctx, { email: "alice@basischina.com", name: "Alice" });

            mockParams.values["id"] = String(alice.id);
            mockSession.value = { user: { id: alice.id } };
            mockBody.value = { profile_theme_image: "data:image/png;base64,!!!" };

            await expect(handler(createEvent())).rejects.toMatchObject({
                statusCode: 400,
                message: "Invalid base64 image data.",
            });
        });

        it.each(["", "A", "AA=A", "AB==", "AAF="])(
            "rejects non-canonical base64 payload %j",
            async (encoded) => {
                const alice = seedUser(ctx, { email: "alice@basischina.com", name: "Alice" });

                mockParams.values["id"] = String(alice.id);
                mockSession.value = { user: { id: alice.id } };
                mockBody.value = { profile_theme_image: `data:image/png;base64,${encoded}` };

                await expect(handler(createEvent())).rejects.toMatchObject({
                    statusCode: 400,
                    message: "Invalid base64 image data.",
                });
            },
        );

        it.each(["+w==", "/w=="])(
            "accepts canonical base64 alphabet characters before rejecting a bad image signature (%s)",
            async (encoded) => {
                const alice = seedUser(ctx, { email: "alice@basischina.com", name: "Alice" });

                mockParams.values["id"] = String(alice.id);
                mockSession.value = { user: { id: alice.id } };
                mockBody.value = { profile_theme_image: `data:image/png;base64,${encoded}` };

                await expect(handler(createEvent())).rejects.toMatchObject({
                    statusCode: 400,
                    message: "Image content does not match its file type.",
                });
            },
        );

        it("rejects an unsupported image mime type", async () => {
            const alice = seedUser(ctx, { email: "alice@basischina.com", name: "Alice" });

            mockParams.values["id"] = String(alice.id);
            mockSession.value = { user: { id: alice.id } };
            mockBody.value = { profile_theme_image: "data:application/pdf;base64,JVBERi0=" };

            await expect(handler(createEvent())).rejects.toMatchObject({
                statusCode: 400,
                message:
                    "Invalid image type for profile theme. Only JPEG, PNG, GIF, and WebP are allowed.",
            });
        });

        it("falls back to bin extension for unknown mime types", async () => {
            const alice = seedUser(ctx, { email: "alice@basischina.com", name: "Alice" });

            mockParams.values["id"] = String(alice.id);
            mockSession.value = { user: { id: alice.id } };
            mockBody.value = { profile_theme_image: "data:application/json;base64,AAAA" };

            await expect(handler(createEvent())).rejects.toMatchObject({
                statusCode: 400,
                message:
                    "Invalid image type for profile theme. Only JPEG, PNG, GIF, and WebP are allowed.",
            });
        });

        it("rejects a profile theme image that exceeds the maximum size", async () => {
            const alice = seedUser(ctx, { email: "alice@basischina.com", name: "Alice" });

            mockParams.values["id"] = String(alice.id);
            mockSession.value = { user: { id: alice.id } };
            mockBody.value = { profile_theme_image: tooLargeBase64() };

            await expect(handler(createEvent())).rejects.toMatchObject({
                statusCode: 413,
                message: "Profile theme image is too large. Maximum size is 7MB.",
            });
        });

        it("uploads a new profile theme image for each accepted image type", async () => {
            const testCases = [
                { dataUrl: VALID_JPEG_BASE64, ext: "jpg", tag: "jpeg" },
                { dataUrl: VALID_PNG_BASE64, ext: "png", tag: "png" },
                { dataUrl: VALID_GIF_BASE64, ext: "gif", tag: "gif89" },
                {
                    dataUrl: "data:image/gif;base64," + Buffer.from("GIF87a").toString("base64"),
                    ext: "gif",
                    tag: "gif87",
                },
                { dataUrl: VALID_WEBP_BASE64, ext: "webp", tag: "webp" },
            ];

            for (const { dataUrl, ext, tag } of testCases) {
                resetMockState();
                createUserAssetContentAddressed.mockClear();
                withAssetLifecycleLocks.mockClear();

                const alice = seedUser(ctx, {
                    email: `alice-${tag}@basischina.com`,
                    name: "Alice",
                });
                ctx.drizzle
                    .update(users)
                    .set({ profile_theme: `url|${OLD_THEME_ASSET}` })
                    .where(eq(users.id, alice.id))
                    .run();

                mockParams.values["id"] = String(alice.id);
                mockSession.value = { user: { id: alice.id } };
                mockBody.value = { profile_theme_image: dataUrl };

                const result = await handler(createEvent());

                expect(result).toEqual({ message: "Your profile is updated" });
                expect(createUserAssetContentAddressed).toHaveBeenCalledWith(
                    expect.any(Buffer),
                    ext,
                );
                expect(withAssetLifecycleLocks.mock.calls[0]?.[1]).toEqual(
                    expect.arrayContaining([
                        OLD_THEME_ASSET,
                        expect.stringMatching(new RegExp(`^profiles/[a-f0-9]{64}\\.${ext}$`)),
                    ]),
                );

                const updated = ctx.drizzle
                    .select()
                    .from(users)
                    .where(eq(users.id, alice.id))
                    .get();
                expect(updated!.profile_theme).toMatch(
                    new RegExp(`^url\\|profiles/[a-f0-9]{64}\\.${ext}$`),
                );
            }
        });

        it("keeps the old asset and database reference safe when the profile update fails", async () => {
            const alice = seedUser(ctx, { email: "alice@basischina.com", name: "Alice" });
            ctx.drizzle
                .update(users)
                .set({ profile_theme: `url|${OLD_THEME_ASSET}` })
                .where(eq(users.id, alice.id))
                .run();
            mockParams.values["id"] = String(alice.id);
            mockSession.value = { user: { id: alice.id } };
            mockBody.value = { profile_theme_image: VALID_PNG_BASE64 };
            assetMocks.failProfileUpdate = true;

            await expect(handler(createEvent())).rejects.toThrow(
                "simulated profile database update failure",
            );

            const updated = ctx.drizzle.select().from(users).where(eq(users.id, alice.id)).get();
            expect(updated!.profile_theme).toBe(`url|${OLD_THEME_ASSET}`);
            expect(createUserAssetContentAddressed).toHaveBeenCalledOnce();
            const orphanPath = getUserAssetContentAddress.mock.results[0]?.value as string;
            expect(orphanPath).toMatch(/^profiles\/[a-f0-9]{64}\.png$/);
            expect(updated!.profile_theme).not.toContain(orphanPath);
            await expect(createUserAssetContentAddressed.mock.results[0]?.value).resolves.toBe(
                orphanPath,
            );
            expect(withAssetLifecycleLocks).toHaveBeenCalledOnce();
            expect(removeUserAsset).not.toHaveBeenCalled();
            expect(getUserAssetContentAddress).toHaveBeenCalledWith(
                Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
                "png",
            );
        });

        it.each([
            ["image/jpeg", "AQID"],
            ["image/jpg", "AQID"],
            ["image/png", "AQID"],
            ["image/gif", "AQID"],
            ["image/webp", "AQID"],
            ["image/webp", "UklGAAAAAFdFVFA="],
        ])("rejects %s data with an invalid image signature", async (mime, encoded) => {
            const alice = seedUser(ctx, { email: "alice@basischina.com", name: "Alice" });

            mockParams.values["id"] = String(alice.id);
            mockSession.value = { user: { id: alice.id } };
            mockBody.value = { profile_theme_image: `data:${mime};base64,${encoded}` };

            await expect(handler(createEvent())).rejects.toMatchObject({
                statusCode: 400,
                message: "Image content does not match its file type.",
            });
        });
    });

    describe("avatar", () => {
        it("clears the existing avatar reference without deleting its asset", async () => {
            const alice = seedUser(ctx, { email: "alice@basischina.com", name: "Alice" });
            ctx.drizzle
                .update(users)
                .set({ profile_picture: OLD_AVATAR_ASSET })
                .where(eq(users.id, alice.id))
                .run();

            mockParams.values["id"] = String(alice.id);
            mockSession.value = { user: { id: alice.id } };
            mockBody.value = { avatar: null };

            const result = await handler(createEvent());

            expect(result).toEqual({ message: "Your profile is updated" });
            expect(withAssetLifecycleLocks).toHaveBeenCalledWith(
                ctx.drizzle,
                [OLD_AVATAR_ASSET],
                expect.any(Function),
            );
            expect(createUserAssetContentAddressed).not.toHaveBeenCalled();

            const updated = ctx.drizzle.select().from(users).where(eq(users.id, alice.id)).get();
            expect(updated!.profile_picture).toBeNull();
        });

        it("rejects an unsupported avatar mime type", async () => {
            const alice = seedUser(ctx, { email: "alice@basischina.com", name: "Alice" });

            mockParams.values["id"] = String(alice.id);
            mockSession.value = { user: { id: alice.id } };
            mockBody.value = { avatar: "data:application/pdf;base64,JVBERi0=" };

            await expect(handler(createEvent())).rejects.toMatchObject({
                statusCode: 400,
                message:
                    "Invalid image type for avatar. Only JPEG, PNG, GIF, and WebP are allowed.",
            });
        });

        it("rejects an avatar that exceeds the maximum size", async () => {
            const alice = seedUser(ctx, { email: "alice@basischina.com", name: "Alice" });

            mockParams.values["id"] = String(alice.id);
            mockSession.value = { user: { id: alice.id } };
            mockBody.value = { avatar: tooLargeBase64() };

            await expect(handler(createEvent())).rejects.toMatchObject({
                statusCode: 413,
                message: "Avatar image is too large. Maximum size is 7MB.",
            });
        });

        it("uploads a new avatar for each accepted image type", async () => {
            const testCases = [
                { dataUrl: VALID_JPEG_BASE64, ext: "jpg" },
                { dataUrl: VALID_PNG_BASE64, ext: "png" },
                { dataUrl: VALID_GIF_BASE64, ext: "gif" },
                { dataUrl: VALID_WEBP_BASE64, ext: "webp" },
            ];

            for (const { dataUrl, ext } of testCases) {
                resetMockState();
                createUserAssetContentAddressed.mockClear();
                withAssetLifecycleLocks.mockClear();

                const alice = seedUser(ctx, {
                    email: `alice-avatar-${ext}@basischina.com`,
                    name: "Alice",
                });
                ctx.drizzle
                    .update(users)
                    .set({ profile_picture: OLD_AVATAR_ASSET })
                    .where(eq(users.id, alice.id))
                    .run();

                mockParams.values["id"] = String(alice.id);
                mockSession.value = { user: { id: alice.id } };
                mockBody.value = { avatar: dataUrl };

                const result = await handler(createEvent());

                expect(result).toEqual({ message: "Your profile is updated" });
                expect(createUserAssetContentAddressed).toHaveBeenCalledWith(
                    expect.any(Buffer),
                    ext,
                );
                expect(withAssetLifecycleLocks.mock.calls[0]?.[1]).toContain(OLD_AVATAR_ASSET);

                const updated = ctx.drizzle
                    .select()
                    .from(users)
                    .where(eq(users.id, alice.id))
                    .get();
                expect(updated!.profile_picture).toMatch(
                    new RegExp(`^profiles/[a-f0-9]{64}\\.${ext}$`),
                );
            }
        });

        it("uses one shared content address for identical avatar and theme bytes", async () => {
            const alice = seedUser(ctx, { email: "alice@basischina.com", name: "Alice" });
            mockParams.values["id"] = String(alice.id);
            mockSession.value = { user: { id: alice.id } };
            mockBody.value = { avatar: VALID_PNG_BASE64, profile_theme_image: VALID_PNG_BASE64 };

            await expect(handler(createEvent())).resolves.toEqual({
                message: "Your profile is updated",
            });

            const updated = ctx.drizzle.select().from(users).where(eq(users.id, alice.id)).get();
            expect(updated!.profile_picture).toMatch(/^profiles\/[a-f0-9]{64}\.png$/);
            expect(updated!.profile_theme).toBe(`url|${updated!.profile_picture}`);
            expect(createUserAssetContentAddressed).toHaveBeenCalledTimes(2);
            expect(withAssetLifecycleLocks.mock.calls[0]?.[1]).toEqual([updated!.profile_picture]);
        });

        it("does not treat legacy or remote profile references as managed GC lock paths", async () => {
            const alice = seedUser(ctx, { email: "alice@basischina.com", name: "Alice" });
            ctx.drizzle
                .update(users)
                .set({
                    profile_picture: "legacy-avatar.png",
                    profile_theme: "url|https://cdn.example.test/legacy-theme.png",
                })
                .where(eq(users.id, alice.id))
                .run();
            mockParams.values["id"] = String(alice.id);
            mockSession.value = { user: { id: alice.id } };
            mockBody.value = { avatar: null, profile_theme_image: null };

            await expect(handler(createEvent())).resolves.toEqual({
                message: "Your profile is updated",
            });

            expect(withAssetLifecycleLocks).toHaveBeenCalledWith(
                ctx.drizzle,
                [],
                expect.any(Function),
            );
            expect(removeUserAsset).not.toHaveBeenCalled();
        });
    });
});
