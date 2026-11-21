import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import {
    createTestContext,
    resetTestContext,
    resetMockState,
    setupNitroGlobals,
    seedHackathon,
    seedSeason,
    type TestContext,
} from "./helpers";

vi.mock("~~/server/utils/rateLimit", () => ({
    applyRateLimit: (fn: any) => fn,
    DEFAULT_RATE_LIMIT_CONFIG: { maxRequests: 6000, windowMs: 60 * 1000 },
}));

let ctx: TestContext;
let calendar: any;
const headers: Array<[string, string]> = [];

beforeAll(async () => {
    setupNitroGlobals();
    vi.stubGlobal("setHeader", (_event: unknown, name: string, value: string) => {
        headers.push([name, value]);
    });
    calendar = (await import("~~/server/routes/calendar.ics.get")).default;
});

beforeEach(async () => {
    resetMockState();
    ctx = await createTestContext();
});

afterEach(() => {
    resetTestContext(ctx);
});

function createEvent() {
    return { context: { drizzle: ctx.drizzle } };
}

describe("GET /calendar.ics", () => {
    it("emits one VEVENT per configured milestone with stable UTC UIDs", async () => {
        const start = Date.UTC(2026, 0, 10, 9, 0, 0);
        const end = Date.UTC(2026, 0, 12, 18, 0, 0);
        const votingStart = Date.UTC(2026, 0, 12, 18, 30, 0);
        const votingEnd = Date.UTC(2026, 0, 14, 18, 0, 0);
        seedHackathon(ctx, {
            status: "in_progress",
            start_timestamp: start,
            end_timestamp: end,
            voting_start_timestamp: votingStart,
            voting_end_timestamp: votingEnd,
            results_open_timestamp: 0,
        });
        const season = seedSeason(ctx, { name: "Test Season, 2026" });

        const body = (await calendar(createEvent())) as string;
        const unfolded = body.replace(/\r\n /g, "");

        expect(body.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
        expect(body.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
        expect(body).toContain(`UID:basishacks-season-${season.id}-event-start`);
        expect(body).toContain("DTSTART:20260110T090000Z");
        expect(body).toContain("DTSTART:20260112T180000Z");
        expect(body).toContain("DTSTART:20260112T183000Z");
        expect(body).toContain("DTSTART:20260114T180000Z");
        // Escaped comma from the season name.
        expect(unfolded).toContain("SUMMARY:Test Season\\, 2026");
        // A zero timestamp is omitted, not rendered as 1970.
        expect(body).not.toContain("results published");
        expect(body).not.toContain("19700101");
        expect((body.match(/BEGIN:VEVENT/g) ?? []).length).toBe(4);
    });

    it("returns a valid empty calendar when no event is configured", async () => {
        const body = await calendar(createEvent());
        expect(body).toContain("BEGIN:VCALENDAR");
        expect(body).not.toContain("BEGIN:VEVENT");
        expect(body.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
    });

    it("sets calendar headers with a no-store cache policy", async () => {
        headers.length = 0;

        await calendar(createEvent());

        expect(headers).toEqual([
            ["content-type", "text/calendar; charset=utf-8"],
            ["cache-control", "no-store"],
        ]);
    });

    it("folds long summary lines at 75 octets without splitting characters", async () => {
        const name = "S".repeat(80);
        resetTestContext(ctx);
        seedHackathon(ctx, { status: "in_progress" });
        seedSeason(ctx, { name });

        const body = (await calendar(createEvent())) as string;
        const foldedLines = body.split("\r\n");
        const unfolded = body.replace(/\r\n /g, "");

        expect(foldedLines.some((line) => line.length > 75)).toBe(false);
        expect(body).toContain("\r\n ");
        expect(unfolded).toContain(`SUMMARY:${name}: submissions close`);
    });

    it("uses a none season identifier when no active season exists", async () => {
        resetTestContext(ctx);
        seedHackathon(ctx, { status: "in_progress" });

        const body = (await calendar(createEvent())) as string;

        expect(body).toContain("UID:basishacks-season-none-event-start");
        expect(body).toContain("SUMMARY:The hackathon: event starts");
    });
});
