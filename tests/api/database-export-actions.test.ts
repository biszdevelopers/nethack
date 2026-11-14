import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NethackPermissions } from "~~/shared/permissions";
import { setupNitroGlobals } from "~~/tests/api/helpers";

const mocks = vi.hoisted(() => ({
    requireUser: vi.fn(),
    snapshotDatabaseExport: vi.fn(),
    sendStream: vi.fn(),
    headers: [] as Array<[string, string]>,
    query: {} as Record<string, unknown>,
}));

vi.mock("~~/server/utils/auth", () => ({ requireUser: mocks.requireUser }));
vi.mock("~~/server/utils/database-export", () => ({
    snapshotDatabaseExport: mocks.snapshotDatabaseExport,
}));
vi.mock("h3", () => ({ sendStream: mocks.sendStream }));
vi.mock("~~/server/utils/rateLimit", () => ({
    applyRateLimit: (handler: unknown) => handler,
    DEFAULT_RATE_LIMIT_CONFIG: {},
}));

let exportDatabase: (event: unknown) => Promise<unknown>;

beforeAll(async () => {
    setupNitroGlobals();
    vi.stubGlobal(
        "getValidatedQuery",
        async (_event: unknown, parse: (value: unknown) => unknown) => parse(mocks.query),
    );
    vi.stubGlobal("setResponseHeader", (_event: unknown, name: string, value: string) => {
        mocks.headers.push([name, value]);
    });

    exportDatabase = (await import("~~/server/api/admin/database/export.get")).default;

    mocks.requireUser.mockResolvedValue({ id: 17 });
    vi.mocked(globalThis.requireUser).mockResolvedValue({ id: 17 } as never);
    mocks.snapshotDatabaseExport.mockReturnValue(["export-data"]);
    mocks.sendStream.mockImplementation((_event: unknown, stream: unknown) => stream);
});

afterEach(() => {
    vi.restoreAllMocks();
    mocks.requireUser.mockReset().mockResolvedValue({ id: 17 });
    vi.mocked(globalThis.requireUser)
        .mockReset()
        .mockResolvedValue({ id: 17 } as never);
    mocks.snapshotDatabaseExport.mockReset().mockReturnValue(["export-data"]);
    mocks.sendStream.mockReset().mockImplementation((_event: unknown, stream: unknown) => stream);
    mocks.headers = [];
    mocks.query = {};
});

describe("database export route", () => {
    it.each([
        ["json", "application/json; charset=utf-8", "basishacks-export.json"],
        ["csv", "text/csv; charset=utf-8", "basishacks-export.csv"],
    ])("streams a %s export with no-store headers", async (format, contentType, filename) => {
        mocks.query = { format };
        const event = { context: { drizzle: { database: true } } };

        const stream = await exportDatabase(event);

        expect(globalThis.requireUser).toHaveBeenCalledWith(
            event,
            NethackPermissions.Database.export,
        );
        expect(mocks.snapshotDatabaseExport).toHaveBeenCalledWith(event.context.drizzle, format);
        expect(mocks.sendStream).toHaveBeenCalledWith(event, expect.any(Object));
        expect(stream).toBe(mocks.sendStream.mock.results[0]?.value);
        expect(mocks.headers).toEqual([
            ["Cache-Control", "no-store"],
            ["Content-Type", contentType],
            ["Content-Disposition", `attachment; filename="${filename}"`],
        ]);
    });

    it("uses JSON by default and rejects unsupported formats before exporting", async () => {
        const event = { context: { drizzle: {} } };

        await exportDatabase(event);
        expect(mocks.snapshotDatabaseExport).toHaveBeenCalledWith(event.context.drizzle, "json");

        mocks.query = { format: "xml" };
        await expect(exportDatabase(event)).rejects.toMatchObject({ name: "ZodError" });
    });

    it("stops before reading the query when authorization fails", async () => {
        vi.mocked(globalThis.requireUser).mockRejectedValueOnce(
            Object.assign(new Error("Forbidden"), { statusCode: 403 }),
        );

        await expect(exportDatabase({ context: { drizzle: {} } })).rejects.toMatchObject({
            statusCode: 403,
        });
        expect(mocks.snapshotDatabaseExport).not.toHaveBeenCalled();
    });
});
