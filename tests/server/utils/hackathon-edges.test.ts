import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    createTestContext,
    resetTestContext,
    seedHackathon,
    type TestContext,
} from "~~/tests/api/helpers";
import {
    getLiveOverrides,
    mergeLiveOverrides,
    pickDivergingLiveOverrides,
} from "~~/server/utils/database/hackathon";

let ctx: TestContext;

beforeEach(async () => {
    ctx = await createTestContext();
});

afterEach(() => {
    resetTestContext(ctx);
});

function createEvent() {
    return { context: { drizzle: ctx.drizzle } } as any;
}

describe("pickDivergingLiveOverrides", () => {
    it("keeps unrelated stored keys and manifest-owned keys", () => {
        const overrides = pickDivergingLiveOverrides(
            { status: "in_progress" },
            { status: "in_progress" },
            { status: "finished", custom: true },
        );

        expect(overrides).toEqual({ custom: true });
    });

    it("drops stored keys that match the manifest exactly", () => {
        const overrides = pickDivergingLiveOverrides(
            { voting_enabled: 1, show_scores: 0 },
            {},
            { voting_enabled: 1, show_scores: 1 },
        );

        expect(overrides).toEqual({ voting_enabled: 1, show_scores: 1 });
    });

    it("keeps stored overrides for keys the manifest does not define", () => {
        const overrides = pickDivergingLiveOverrides(null, {}, { status: "finished", extra: 1 });

        expect(overrides).toEqual({ status: "finished", extra: 1 });
    });

    it("stores only settings that differ from the manifest", () => {
        const overrides = pickDivergingLiveOverrides(
            { status: "in_progress", theme_name: "Manifest theme" },
            {
                status: "finished",
                theme_name: "Manifest theme",
                voting_enabled: 0,
                theme_description: "Not a live override",
            },
            {},
        );

        expect(overrides).toEqual({ status: "finished", voting_enabled: 0 });
    });

    it("keeps stored values for keys absent from the incoming settings", () => {
        const overrides = pickDivergingLiveOverrides(
            { status: "in_progress", voting_enabled: 0 },
            { status: "in_progress" },
            { voting_enabled: 1 },
        );

        expect(overrides).toEqual({ voting_enabled: 1 });
    });
});

describe("mergeLiveOverrides", () => {
    it("merges stored JSON text with the incoming update", () => {
        expect(mergeLiveOverrides('{"status":"finished"}', { voting_enabled: 1 })).toEqual({
            status: "finished",
            voting_enabled: 1,
        });
    });

    it("ignores malformed stored JSON", () => {
        expect(mergeLiveOverrides("{", { status: "finished" })).toEqual({ status: "finished" });
    });

    it.each([null, undefined, 3, "[]", [], "true"])(
        "returns the incoming update for stored value %j",
        (stored) => {
            expect(mergeLiveOverrides(stored, { status: "finished" })).toEqual({
                status: "finished",
            });
        },
    );

    it("merges stored objects", () => {
        expect(
            mergeLiveOverrides({ status: "finished", show_scores: 1 }, { voting_enabled: 1 }),
        ).toEqual({ status: "finished", show_scores: 1, voting_enabled: 1 });
    });
});

describe("getLiveOverrides", () => {
    it("returns an empty object when no live row exists", async () => {
        await expect(getLiveOverrides(createEvent())).resolves.toEqual({});
    });

    it.each([null, "", "not json", 42])(
        "returns an empty object for an unusable stored value %j",
        async (stored) => {
            seedHackathon(ctx);
            ctx.sqlite
                .prepare("UPDATE hackathon SET live_overrides = ? WHERE id = 1")
                .run(JSON.stringify(stored));

            await expect(getLiveOverrides(createEvent())).resolves.toEqual({});
        },
    );

    it("parses a double-encoded string payload", async () => {
        seedHackathon(ctx);
        ctx.sqlite
            .prepare("UPDATE hackathon SET live_overrides = ? WHERE id = 1")
            .run(JSON.stringify(JSON.stringify({ status: "finished" })));

        await expect(getLiveOverrides(createEvent())).resolves.toEqual({ status: "finished" });
    });

    it("rejects an invalid override shape", async () => {
        seedHackathon(ctx);
        ctx.sqlite
            .prepare("UPDATE hackathon SET live_overrides = ? WHERE id = 1")
            .run(JSON.stringify({ status: 123 }));

        await expect(getLiveOverrides(createEvent())).resolves.toEqual({});
    });

    it("accepts a valid stored override object", async () => {
        seedHackathon(ctx);
        ctx.sqlite
            .prepare("UPDATE hackathon SET live_overrides = ? WHERE id = 1")
            .run(JSON.stringify({ status: "finished", voting_enabled: 1 }));

        await expect(getLiveOverrides(createEvent())).resolves.toEqual({
            status: "finished",
            voting_enabled: 1,
        });
    });
});
