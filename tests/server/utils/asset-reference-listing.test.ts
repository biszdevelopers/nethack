import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import type { DrizzleDatabase } from "~~/server/database";
import { assetReferences } from "~~/server/database/schema";
import { listAssetReferences } from "~~/server/utils/assets";

interface StoredReference {
    id: string;
    collection: "assets" | "userassets";
    asset_path: string;
    created_at: Date;
    created_by: number | null;
}

function databaseWithReferences(
    references: StoredReference[],
    options: { omitCountRow?: boolean } = {},
) {
    const dialect = new PgDialect();
    const matchesFilter = (reference: StoredReference, filter: unknown) => {
        if (filter === undefined) return true;
        const query = dialect.sqlToQuery(filter as never);
        if (!query.sql.includes('"asset_references"."created_by"')) {
            throw new Error("Unexpected permalink reference listing filter");
        }
        return query.params.includes(reference.created_by);
    };
    const select = vi.fn((selection: Record<string, unknown>) => {
        const isCountQuery = Object.hasOwn(selection, "total");
        const state: { filter?: unknown; limit?: number; offset?: number } = {};
        const filtered = () =>
            references.filter((reference) => matchesFilter(reference, state.filter));
        const query: any = {
            from: vi.fn((table: unknown) => {
                if (table !== assetReferences) throw new Error("Unexpected listing table");
                return query;
            }),
            where: vi.fn((filter: unknown) => {
                state.filter = filter;
                return query;
            }),
            orderBy: vi.fn(() => query),
            limit: vi.fn((limit: number) => {
                state.limit = limit;
                return query;
            }),
            offset: vi.fn(async (offset: number) => {
                state.offset = offset;
                return filtered()
                    .sort(
                        (first, second) =>
                            second.created_at.getTime() - first.created_at.getTime() ||
                            second.id.localeCompare(first.id),
                    )
                    .slice(offset, offset + (state.limit ?? 0))
                    .map(({ id, collection, asset_path, created_at }) => ({
                        id,
                        collection,
                        asset_path,
                        created_at,
                    }));
            }),
            then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
                Promise.resolve(options.omitCountRow ? [] : [{ total: filtered().length }]).then(
                    resolve,
                    reject,
                ),
        };
        if (!isCountQuery) {
            query.then = (
                resolve: (value: unknown) => unknown,
                reject: (error: unknown) => unknown,
            ) => Promise.resolve([]).then(resolve, reject);
        }
        return query;
    });
    return { database: { select } as unknown as DrizzleDatabase, select };
}

describe("managed permalink reference listing", () => {
    const references: StoredReference[] = [
        {
            id: "owner-newest",
            collection: "assets",
            asset_path: "uploads/newest.png",
            created_at: new Date("2026-11-14T12:00:00Z"),
            created_by: 9,
        },
        {
            id: "owner-older",
            collection: "userassets",
            asset_path: "older file.webp",
            created_at: new Date("2026-11-14T11:00:00Z"),
            created_by: 9,
        },
        {
            id: "other-user",
            collection: "assets",
            asset_path: "uploads/private.png",
            created_at: new Date("2026-11-14T13:00:00Z"),
            created_by: 10,
        },
        {
            id: "deleted-owner",
            collection: "assets",
            asset_path: "uploads/orphaned-owner.png",
            created_at: new Date("2026-11-14T10:00:00Z"),
            created_by: null,
        },
    ];

    it("filters to the owner before counting and paginating", async () => {
        const { database } = databaseWithReferences(references);

        await expect(
            listAssetReferences(database, 9, false, { page: 1, pageSize: 1 }),
        ).resolves.toEqual({
            items: [
                {
                    id: "owner-newest",
                    collection: "assets",
                    asset_path: "uploads/newest.png",
                    created_at: new Date("2026-11-14T12:00:00Z"),
                    permalink: "/assets/uploads/newest.png",
                },
            ],
            page: 1,
            page_size: 1,
            total: 2,
            total_pages: 2,
        });
    });

    it("allows admins to page across all references and encodes path segments", async () => {
        const { database } = databaseWithReferences(references);

        await expect(
            listAssetReferences(database, 9, true, { page: 1, pageSize: 4 }),
        ).resolves.toMatchObject({
            items: [
                {
                    id: "other-user",
                    permalink: "/assets/uploads/private.png",
                },
                {
                    id: "owner-newest",
                    permalink: "/assets/uploads/newest.png",
                },
                {
                    id: "owner-older",
                    permalink: "/userast/older%20file.webp",
                },
                {
                    id: "deleted-owner",
                    permalink: "/assets/uploads/orphaned-owner.png",
                },
            ],
            page: 1,
            page_size: 4,
            total: 4,
            total_pages: 1,
        });
    });

    it("fails closed for invalid collection values", async () => {
        const { database } = databaseWithReferences([
            {
                ...references[0]!,
                collection: "unknown" as StoredReference["collection"],
            },
        ]);

        await expect(
            listAssetReferences(database, 9, true, { page: 1, pageSize: 20 }),
        ).rejects.toThrow("unsupported collection");
    });

    it("returns an empty first page when an aggregate query has no rows", async () => {
        const { database } = databaseWithReferences([], { omitCountRow: true });

        await expect(
            listAssetReferences(database, 9, false, { page: 1, pageSize: 20 }),
        ).resolves.toEqual({ items: [], page: 1, page_size: 20, total: 0, total_pages: 0 });
    });
});
